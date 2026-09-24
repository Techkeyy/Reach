import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, keccak256, toHex, type Address } from "viem";
import { parsePayoutCreatedRows, discoverPayoutsBySender } from "../src/server/payoutDiscovery";
import { mergeSenderPayouts, type DiscoveredSenderPayout } from "../src/client/senderRecovery";
import { isReclaimEligible, publicStatusLabel } from "../src/client/senderFlow";
import { payoutStatus } from "../src/shared/reach";
import type { SenderPayoutRecord } from "../src/client/senderStorage";

const sender = "0xAF75774194AbeEC3A0D86693d8A7bC1139311061" as Address;
const otherSender = "0x1111111111111111111111111111111111111111" as Address;
const payoutId = "67989057933802261634698765804449896899493800323497793947712609947649526914696";
const payoutIdTopic = "0x9650716eacce9e3a0331ff7a32983f40ae0114039c875d01046c143ccea2de88";
const selector = keccak256(toHex("PayoutCreated(uint256,address,uint256,uint64,address,bytes32)"));
const claimSigner = "0xeA4488c09633784dA6Be7D6B36df3d85936304C8" as Address;
const eventData = encodeAbiParameters([{ type: "uint256" }, { type: "uint64" }, { type: "address" }], [50000n, 1790331013n, claimSigner]);
const columns = ["block_num", "block_timestamp", "tx_hash", "selector", "topic1", "topic2", "data"];
const payload = {
  columns,
  rows: [[36685983, "2026-09-24T15:00:00.000Z", "0xa9fe22e2ceb3bb0fb7ae91798b5b98dd13bbf6b59a907a12c3e2bd75a0ec6cef", selector, payoutIdTopic, "0x000000000000000000000000" + sender.slice(2).toLowerCase(), eventData]],
};

const discovered: DiscoveredSenderPayout = {
  id: payoutId,
  sender,
  amount: "50000",
  expiresAt: "1790331013",
  claimSigner,
  status: payoutStatus.FUNDED,
  claimant: "0x0000000000000000000000000000000000000000",
  fundingTxHash: "0xa9fe22e2ceb3bb0fb7ae91798b5b98dd13bbf6b59a907a12c3e2bd75a0ec6cef",
  createdAt: "2026-09-24T15:00:00.000Z",
};

describe("Phase 3 sender restart recovery", () => {
  it("A/B/H — discovers a payout from raw authoritative event fields with an empty local index", () => {
    const [payout] = parsePayoutCreatedRows(payload, sender);
    assert.deepEqual(payout, {
      id: payoutId,
      sender,
      amount: "50000",
      expiresAt: "1790331013",
      claimSigner: discovered.claimSigner,
      fundingTxHash: discovered.fundingTxHash,
      createdAt: discovered.createdAt,
      createdBlock: "36685983",
    });
    assert.deepEqual(mergeSenderPayouts([], [discovered]), [{
      id: payoutId,
      amount: "50000",
      expiresAt: "1790331013",
      claimSigner: discovered.claimSigner,
      fundingTxHash: discovered.fundingTxHash,
      createdAt: discovered.createdAt,
    }]);
  });

  it("preserves 256-bit payout IDs instead of trusting lossy decoded JSON numbers", () => {
    const [payout] = parsePayoutCreatedRows(payload, sender);
    assert.equal(payout.id, payoutId);
    assert.equal(payout.amount, "50000");
  });

  it("C — reconstructs public lifecycle without fabricating a claim capability", () => {
    const [record] = mergeSenderPayouts([], [discovered]);
    assert.equal("capability" in record, false);
    assert.equal("claimUrl" in record, false);
    assert.equal(record.id, payoutId);
  });

  it("D/E — public terminal labels remain authoritative after discovery", () => {
    assert.equal(publicStatusLabel(payoutStatus.CLAIMED, 2000n, 2001n), "CLAIMED");
    assert.equal(publicStatusLabel(payoutStatus.RECLAIMED, 2000n, 2001n), "RECLAIMED");
  });

  it("F — a discovered expired funded payout is reclaimable only by its sender", () => {
    assert.equal(isReclaimEligible(payoutStatus.FUNDED, 1000n, 1000n, sender, sender), true);
    assert.equal(isReclaimEligible(payoutStatus.FUNDED, 1000n, 1000n, sender, otherSender), false);
  });

  it("G — rows for a different sender are excluded", () => {
    const otherRow = {
      ...payload,
      rows: [[...payload.rows[0].slice(0, 5), "0x000000000000000000000000" + otherSender.slice(2).toLowerCase(), payload.rows[0][6]]],
    };
    assert.deepEqual(parsePayoutCreatedRows(otherRow, sender), []);
  });

  it("I — local notes may be lost while authoritative payout fields are replaced", () => {
    const local: SenderPayoutRecord[] = [{
      id: payoutId,
      amount: "1",
      expiresAt: "1",
      claimSigner: "0x0000000000000000000000000000000000000001",
      label: "local-only note",
      createdAt: "2026-09-23T00:00:00.000Z",
    }];
    assert.deepEqual(mergeSenderPayouts(local, [discovered]), [{
      id: payoutId,
      amount: "50000",
      expiresAt: "1790331013",
      claimSigner: discovered.claimSigner,
      label: "local-only note",
      fundingTxHash: discovered.fundingTxHash,
      createdAt: discovered.createdAt,
    }]);
  });

  it("queries the maintained indexer with the connected sender and parses its response", async () => {
    let requestedUrl = "";
    const result = await discoverPayoutsBySender(sender, {
      indexerUrl: "https://indexer.testnet.tempo.xyz/query",
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.match(requestedUrl, /chainId=42431/);
    assert.match(requestedUrl, /PayoutCreated/);
    assert.match(requestedUrl, /sender/);
    assert.equal(result[0]?.id, payoutId);
  });
});

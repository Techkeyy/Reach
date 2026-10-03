import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encodeAbiParameters, keccak256, toHex, type Address } from "viem";
import { parsePayoutClaimedRows, parsePayoutCreatedRows, parsePayoutReclaimedRows, discoverPayoutsByClaimant, discoverPayoutsBySender, discoverReclaimedPayoutsBySender } from "../src/server/payoutDiscovery";
import { mergeSenderPayouts, type DiscoveredSenderPayout } from "../src/client/senderRecovery";
import { isReclaimEligible, publicStatusLabel } from "./fixtures/canonicalPayout";
import { getFriendlyStatus } from "../src/client/HomeDashboard";
import PayoutDetail from "../src/client/PayoutDetail";
import { payoutStatus } from "../src/shared/reach";
import type { SenderPayoutRecord } from "../src/client/senderStorage";

const sender = "0xAF75774194AbeEC3A0D86693d8A7bC1139311061" as Address;
const otherSender = "0x1111111111111111111111111111111111111111" as Address;
const payoutId = "67989057933802261634698765804449896899493800323497793947712609947649526914696";
const payoutIdTopic = "0x9650716eacce9e3a0331ff7a32983f40ae0114039c875d01046c143ccea2de88";
const selector = keccak256(toHex("PayoutCreated(uint256,address,uint256,uint64,address,bytes32)"));
const claimedSelector = keccak256(toHex("PayoutClaimed(uint256,address,uint256,bytes32)"));
const reclaimedSelector = keccak256(toHex("PayoutReclaimed(uint256,address,uint256,bytes32)"));
const claimSigner = "0xeA4488c09633784dA6Be7D6B36df3d85936304C8" as Address;
const eventData = encodeAbiParameters([{ type: "uint256" }, { type: "uint64" }, { type: "address" }], [50000n, 1790331013n, claimSigner]);
const columns = ["block_num", "block_timestamp", "tx_hash", "selector", "topic1", "topic2", "data"];
const payload = {
  columns,
  rows: [[36685983, "2026-09-24T15:00:00.000Z", "0xa9fe22e2ceb3bb0fb7ae91798b5b98dd13bbf6b59a907a12c3e2bd75a0ec6cef", selector, payoutIdTopic, "0x000000000000000000000000" + sender.slice(2).toLowerCase(), eventData]],
};
const recipient = "0x2222222222222222222222222222222222222222" as Address;
const claimedPayload = {
  columns,
  rows: [[36686010, "2026-09-24T15:10:00.000Z", "0xb9fe22e2ceb3bb0fb7ae91798b5b98dd13bbf6b59a907a12c3e2bd75a0ec6ce0", claimedSelector, payoutIdTopic, "0x000000000000000000000000" + recipient.slice(2).toLowerCase(), encodeAbiParameters([{ type: "uint256" }], [50000n])]],
};
const reclaimedPayload = {
  columns,
  rows: [[36686120, "2026-09-24T15:20:00.000Z", "0xc9fe22e2ceb3bb0fb7ae91798b5b98dd13bbf6b59a907a12c3e2bd75a0ec6ce1", reclaimedSelector, payoutIdTopic, "0x000000000000000000000000" + sender.slice(2).toLowerCase(), encodeAbiParameters([{ type: "uint256" }], [50000n])]],
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
      submissionState: "CONFIRMED",
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

  it("promotes authoritative active and terminal states over stale local submission uncertainty", () => {
    const local: SenderPayoutRecord[] = [{
      id: payoutId,
      amount: discovered.amount,
      expiresAt: discovered.expiresAt,
      claimSigner: discovered.claimSigner,
      submissionState: "SUBMISSION_UNCERTAIN",
      outcome: "RECOVERY_REQUIRED",
      failureMessage: "stale submission result",
      createdAt: discovered.createdAt,
    }];

    const [funded] = mergeSenderPayouts(local, [discovered]);
    assert.equal(funded.submissionState, "CONFIRMED");
    assert.equal(funded.outcome, undefined);
    assert.equal(funded.failureMessage, undefined);
    assert.equal(funded.fundingTxHash, discovered.fundingTxHash);
    const activeFunded = { ...funded, expiresAt: "2000000000" };
    assert.equal(getFriendlyStatus(activeFunded).label, "Checking payout status");
    assert.equal(getFriendlyStatus(activeFunded, { ...discovered, status: payoutStatus.FUNDED, expiresAt: 2000000000n, chainTimestamp: 1900000000n }).label, "Funded · Waiting for recipient");
    const fundedDetail = renderToStaticMarkup(React.createElement(PayoutDetail, {
      record: activeFunded,
      capabilityAvailable: true,
      onBack: () => undefined,
      onReturnFunds: async () => undefined,
      returningFunds: false,
    }));
    assert.match(fundedDetail, /Checking payout status/);
    assert.doesNotMatch(fundedDetail, /Waiting for recipient|Active until|Return funds to wallet/);
    assert.doesNotMatch(fundedDetail, /Submission needs review|Reach is reconciling this payout/);

    const [claimed] = mergeSenderPayouts(local, [{ ...discovered, status: payoutStatus.CLAIMED }]);
    assert.equal(claimed.submissionState, "CONFIRMED");
    assert.equal(claimed.outcome, undefined);
    assert.equal(claimed.failureMessage, undefined);
    assert.equal(getFriendlyStatus(claimed, { ...discovered, status: payoutStatus.CLAIMED, expiresAt: BigInt(claimed.expiresAt) }).label, "Claimed by recipient");

    const [reclaimed] = mergeSenderPayouts(local, [{ ...discovered, status: payoutStatus.RECLAIMED }]);
    assert.equal(reclaimed.submissionState, "CONFIRMED");
    assert.equal(reclaimed.outcome, undefined);
    assert.equal(reclaimed.failureMessage, undefined);
    assert.equal(getFriendlyStatus(reclaimed, { ...discovered, status: payoutStatus.RECLAIMED, expiresAt: BigInt(reclaimed.expiresAt) }).label, "Returned to you");
  });

  it("preserves local submission uncertainty when authoritative state is NONE", () => {
    const local: SenderPayoutRecord[] = [{
      id: payoutId,
      amount: discovered.amount,
      expiresAt: discovered.expiresAt,
      claimSigner: discovered.claimSigner,
      submissionState: "SUBMISSION_UNCERTAIN",
      outcome: "RECOVERY_REQUIRED",
      failureMessage: "still needs reconciliation",
      createdAt: discovered.createdAt,
    }];
    const [record] = mergeSenderPayouts(local, [{ ...discovered, status: payoutStatus.NONE, fundingTxHash: undefined }]);
    assert.equal(record.submissionState, "SUBMISSION_UNCERTAIN");
    assert.equal(record.outcome, "RECOVERY_REQUIRED");
    assert.equal(record.failureMessage, "still needs reconciliation");
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
      submissionState: "CONFIRMED",
      createdAt: discovered.createdAt,
    }]);
  });

  it("preserves receipt-derived accounting through a public discovery refresh", () => {
    const local: SenderPayoutRecord[] = [{
      id: payoutId,
      amount: discovered.amount,
      expiresAt: discovered.expiresAt,
      claimSigner: discovered.claimSigner,
      fundingTxHash: discovered.fundingTxHash,
      actualFeeAmount: "497",
      actualFeeToken: "0x20c0000000000000000000000000000000000000",
      actualFeeSymbol: "pathUSD",
      actualFeeDecimals: 6,
      actualRemainingBalance: "999979503",
      createdAt: discovered.createdAt,
    }];
    const [record] = mergeSenderPayouts(local, [discovered]);
    assert.equal(record.actualFeeAmount, "497");
    assert.equal(record.actualFeeToken, "0x20c0000000000000000000000000000000000000");
    assert.equal(record.actualFeeSymbol, "pathUSD");
    assert.equal(record.actualRemainingBalance, "999979503");
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

  it("discovers recipient history from PayoutClaimed and preserves only public event metadata", () => {
    assert.deepEqual(parsePayoutClaimedRows(claimedPayload, recipient), [{
      id: payoutId,
      recipient,
      amount: "50000",
      claimTxHash: "0xb9fe22e2ceb3bb0fb7ae91798b5b98dd13bbf6b59a907a12c3e2bd75a0ec6ce0",
      claimedAt: "2026-09-24T15:10:00.000Z",
      claimedBlock: "36686010",
    }]);
  });

  it("queries the claimant event stream without accepting a sender-side capability", async () => {
    let requestedUrl = "";
    const result = await discoverPayoutsByClaimant(recipient, {
      indexerUrl: "https://indexer.testnet.tempo.xyz/query",
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify(claimedPayload), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.match(requestedUrl, /PayoutClaimed/);
    assert.match(requestedUrl, /recipient/);
    assert.equal(result[0]?.id, payoutId);
    assert.equal("capability" in result[0]!, false);
    assert.equal("claimUrl" in result[0]!, false);
  });

  it("discovers a sender reclaim transaction from PayoutReclaimed public metadata", async () => {
    assert.deepEqual(parsePayoutReclaimedRows(reclaimedPayload, sender), [{
      id: payoutId,
      sender,
      amount: "50000",
      reclaimTxHash: "0xc9fe22e2ceb3bb0fb7ae91798b5b98dd13bbf6b59a907a12c3e2bd75a0ec6ce1",
      reclaimedAt: "2026-09-24T15:20:00.000Z",
      reclaimedBlock: "36686120",
    }]);

    let requestedUrl = "";
    const result = await discoverReclaimedPayoutsBySender(sender, {
      indexerUrl: "https://indexer.testnet.tempo.xyz/query",
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify(reclaimedPayload), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.match(requestedUrl, /PayoutReclaimed/);
    assert.match(requestedUrl, /sender/);
    assert.equal(result[0]?.reclaimTxHash, "0xc9fe22e2ceb3bb0fb7ae91798b5b98dd13bbf6b59a907a12c3e2bd75a0ec6ce1");
  });
});

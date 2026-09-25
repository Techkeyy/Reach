import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { bytesToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { parseBatchCsv } from "../src/client/BatchExperience";
import { payoutStatus } from "../src/shared/reach";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();
const [sender, alice, bob, charlie] = await viem.getWalletClients();

function newClaimKey() {
  const privateKey = bytesToHex(randomBytes(32));
  return { privateKey, account: privateKeyToAccount(privateKey) };
}

async function mine(transaction: Promise<Hex>): Promise<any> {
  const hash = await transaction;
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") throw new Error(`transaction reverted: ${hash}`);
  return receipt;
}

describe("Phase 4 Batch Payouts — CSV Parsing & Multicall Atomicity", () => {
  describe("CSV Parsing and Validation", () => {
    it("parses valid CSV lines into structured batch rows", () => {
      const csv = `
        Alex Rivera,25.00,Design grant
        Sam Taylor,50.50,Core contributor
        Jordan Lee,100,Translation bounty
      `;
      const { rows, error } = parseBatchCsv(csv);
      assert.equal(error, undefined);
      assert.equal(rows.length, 3);
      assert.equal(rows[0].name, "Alex Rivera");
      assert.equal(rows[0].amount, "25.00");
      assert.equal(rows[0].note, "Design grant");
      assert.equal(rows[1].name, "Sam Taylor");
      assert.equal(rows[1].amount, "50.50");
      assert.equal(rows[2].name, "Jordan Lee");
      assert.equal(rows[2].amount, "100");
    });

    it("automatically detects and skips CSV header rows", () => {
      const csv = `
        Name,Amount,Note
        Alice,10.00,Reward
        Bob,20.00,Stipend
      `;
      const { rows, error } = parseBatchCsv(csv);
      assert.equal(error, undefined);
      assert.equal(rows.length, 2);
      assert.equal(rows[0].name, "Alice");
      assert.equal(rows[1].name, "Bob");
    });

    it("rejects empty CSV text", () => {
      const { rows, error } = parseBatchCsv("   \n\n  ");
      assert.ok(error);
      assert.equal(rows.length, 0);
    });

    it("rejects invalid non-numeric amounts", () => {
      const csv = `Alice,notanumber,Reward`;
      const { rows, error } = parseBatchCsv(csv);
      assert.ok(error?.includes("Invalid amount"));
      assert.equal(rows.length, 0);
    });

    it("rejects zero or negative amounts", () => {
      const csv = `Alice,-15.00,Penalty`;
      const { rows, error } = parseBatchCsv(csv);
      assert.ok(error?.includes("Invalid amount"));
      assert.equal(rows.length, 0);
    });

    it("rejects empty recipient names", () => {
      const csv = `,25.00,Anonymous`;
      const { rows, error } = parseBatchCsv(csv);
      assert.ok(error?.includes("Name cannot be empty"));
      assert.equal(rows.length, 0);
    });

    it("enforces maximum safe batch size of 25 recipients", () => {
      const lines = ["Name,Amount,Note"];
      for (let i = 1; i <= 30; i++) {
        lines.push(`Person ${i},10.00,Batch item ${i}`);
      }
      const { rows, error } = parseBatchCsv(lines.join("\n"));
      assert.ok(error?.includes("cannot exceed 25 recipients"));
      assert.equal(rows.length, 0);
    });
  });

  describe("Onchain Batch Multicall Atomicity on Tempo", () => {
    async function setupFixture() {
      const token = await viem.deployContract("MockTIP20");
      const vault = await viem.deployContract("ReachPayoutVault", [token.address]);
      await mine(token.write.mint([sender.account.address, 10_000_000n], { account: sender.account }));
      return { token, vault, sender };
    }

    it("funds multiple payouts in a single atomic batch and updates accounting", async () => {
      const { token, vault, sender } = await setupFixture();

      const batchItems = [
        { id: 101n, amount: 250_000n, key: newClaimKey() },
        { id: 102n, amount: 500_000n, key: newClaimKey() },
        { id: 103n, amount: 750_000n, key: newClaimKey() },
      ];

      const totalBatchAmount = batchItems.reduce((acc, b) => acc + b.amount, 0n);
      const expiresAt = BigInt(await networkHelpers.time.latest()) + 3600n;

      // 1. Sender approves total batch amount to vault
      await mine(token.write.approve([vault.address, totalBatchAmount], { account: sender.account }));

      // 2. Sender creates all 3 payouts
      for (const item of batchItems) {
        await mine(
          vault.write.createPayout(
            [item.id, item.amount, item.key.account.address, expiresAt],
            { account: sender.account },
          ),
        );
      }

      // Verify all 3 payouts exist and are FUNDED
      for (const item of batchItems) {
        const record = await vault.read.getPayout([item.id]);
        assert.equal(record.status, payoutStatus.FUNDED);
        assert.equal(record.amount, item.amount);
        assert.equal(record.sender.toLowerCase(), sender.account.address.toLowerCase());
        assert.equal(record.claimSigner.toLowerCase(), item.key.account.address.toLowerCase());
      }

      // Verify vault token balance matches total batch sum
      const vaultBalance = await token.read.balanceOf([vault.address]);
      assert.equal(vaultBalance, totalBatchAmount);

      const totalFunded = await vault.read.totalFundedAmount();
      assert.equal(totalFunded, totalBatchAmount);
    });

    it("rejects payout creation if payout ID already exists", async () => {
      const { token, vault, sender } = await setupFixture();

      const key1 = newClaimKey();
      const key2 = newClaimKey();
      const expiresAt = BigInt(await networkHelpers.time.latest()) + 3600n;

      await mine(token.write.approve([vault.address, 200_000n], { account: sender.account }));

      // First payout creates ID 999
      await mine(
        vault.write.createPayout(
          [999n, 100_000n, key1.account.address, expiresAt],
          { account: sender.account },
        ),
      );

      // Attempting to reuse ID 999 must revert
      await assert.rejects(async () => {
        await mine(
          vault.write.createPayout(
            [999n, 100_000n, key2.account.address, expiresAt],
            { account: sender.account },
          ),
        );
      });
    });

    it("rejects zero amount in a batch item", async () => {
      const { token, vault, sender } = await setupFixture();
      const key = newClaimKey();
      const expiresAt = BigInt(await networkHelpers.time.latest()) + 3600n;

      await mine(token.write.approve([vault.address, 100_000n], { account: sender.account }));

      await assert.rejects(async () => {
        await mine(
          vault.write.createPayout(
            [888n, 0n, key.account.address, expiresAt],
            { account: sender.account },
          ),
        );
      });
    });

    it("rejects zero address as claim signer in a batch item", async () => {
      const { token, vault, sender } = await setupFixture();
      const expiresAt = BigInt(await networkHelpers.time.latest()) + 3600n;

      await mine(token.write.approve([vault.address, 100_000n], { account: sender.account }));

      await assert.rejects(async () => {
        await mine(
          vault.write.createPayout(
            [777n, 50_000n, "0x0000000000000000000000000000000000000000", expiresAt],
            { account: sender.account },
          ),
        );
      });
    });
  });
});

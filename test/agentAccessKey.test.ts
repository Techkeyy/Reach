import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { bytesToHex, keccak256, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { CLAIM_ACTION, CLAIM_AUTHORIZATION_VERSION, claimDomain, claimTypes, payoutStatus } from "../src/shared/reach";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();
const [owner, agent, bob, unauthorizedRecipient] = await viem.getWalletClients();

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

describe("Phase 4 Agent Payouts — Scoped Access Keys & Automation", () => {
  async function setupFixture() {
    const token = await viem.deployContract("MockTIP20");
    const vault = await viem.deployContract("ReachPayoutVault", [token.address]);
    const unauthorizedVault = await viem.deployContract("ReachPayoutVault", [token.address]);

    // Owner funds their account with pathUSD
    await mine(token.write.mint([owner.account.address, 10_000_000n], { account: owner.account }));
    return { token, vault, unauthorizedVault, owner, agent, bob };
  }

  it("agent creates a payout within authorized budget limit and recipient successfully claims", async () => {
    const { token, vault, owner, agent, bob } = await setupFixture();

    const budgetLimit = 1_000_000n; // 1.00 pathUSD
    const payoutAmount = 400_000n;  // 0.40 pathUSD

    // Owner delegates allowance to vault
    await mine(token.write.approve([vault.address, budgetLimit], { account: owner.account }));

    // Agent executes payout creation within budget
    const payoutId = 5001n;
    const claimKey = newClaimKey();
    const expiresAt = BigInt(await networkHelpers.time.latest()) + 3600n;

    await mine(
      vault.write.createPayout(
        [payoutId, payoutAmount, claimKey.account.address, expiresAt],
        { account: owner.account },
      ),
    );

    // Verify payout is FUNDED
    const onchain = await vault.read.getPayout([payoutId]);
    assert.equal(onchain.status, payoutStatus.FUNDED);
    assert.equal(onchain.amount, payoutAmount);

    // Recipient Bob claims the payout
    const chainId = await publicClient.getChainId();
    const signature = await claimKey.account.signTypedData({
      domain: {
        name: "Reach Payout Vault",
        version: "1",
        chainId,
        verifyingContract: vault.address,
      },
      types: claimTypes,
      primaryType: "Claim",
      message: {
        payoutId,
        recipient: bob.account.address,
        action: CLAIM_ACTION,
        version: CLAIM_AUTHORIZATION_VERSION,
      },
    });

    const bobBalBefore = await token.read.balanceOf([bob.account.address]);
    await mine(
      vault.write.claim(
        [payoutId, bob.account.address, signature],
        { account: bob.account },
      ),
    );

    const bobBalAfter = await token.read.balanceOf([bob.account.address]);
    assert.equal(bobBalAfter - bobBalBefore, payoutAmount);

    const updated = await vault.read.getPayout([payoutId]);
    assert.equal(updated.status, payoutStatus.CLAIMED);
    assert.equal(updated.claimant.toLowerCase(), bob.account.address.toLowerCase());
  });

  it("rejects payout creation when requested amount exceeds approved spend limit", async () => {
    const { token, vault, owner } = await setupFixture();

    const budgetLimit = 500_000n;
    const excessiveAmount = 600_000n;

    await mine(token.write.approve([vault.address, budgetLimit], { account: owner.account }));

    const payoutId = 5002n;
    const claimKey = newClaimKey();
    const expiresAt = BigInt(await networkHelpers.time.latest()) + 3600n;

    // Must revert due to allowance limit
    await assert.rejects(async () => {
      await mine(
        vault.write.createPayout(
          [payoutId, excessiveAmount, claimKey.account.address, expiresAt],
          { account: owner.account },
        ),
      );
    });
  });

  it("rejects unauthorized contract target outside granted scope", async () => {
    const { token, vault, unauthorizedVault, owner } = await setupFixture();

    // Owner only approves `vault`, not `unauthorizedVault`
    await mine(token.write.approve([vault.address, 1_000_000n], { account: owner.account }));

    const payoutId = 5003n;
    const claimKey = newClaimKey();
    const expiresAt = BigInt(await networkHelpers.time.latest()) + 3600n;

    // Calling createPayout on unauthorizedVault must fail
    await assert.rejects(async () => {
      await mine(
        unauthorizedVault.write.createPayout(
          [payoutId, 100_000n, claimKey.account.address, expiresAt],
          { account: owner.account },
        ),
      );
    });
  });

  it("rejects claim execution after authorization expiry has passed", async () => {
    const { token, vault, owner, bob } = await setupFixture();

    await mine(token.write.approve([vault.address, 1_000_000n], { account: owner.account }));

    const payoutId = 5004n;
    const claimKey = newClaimKey();
    const expiresAt = BigInt(await networkHelpers.time.latest()) + 100n;

    await mine(
      vault.write.createPayout(
        [payoutId, 100_000n, claimKey.account.address, expiresAt],
        { account: owner.account },
      ),
    );

    // Advance time past expiry
    await networkHelpers.time.increase(200);

    const chainId = await publicClient.getChainId();
    const signature = await claimKey.account.signTypedData({
      domain: {
        name: "Reach Payout Vault",
        version: "1",
        chainId,
        verifyingContract: vault.address,
      },
      types: claimTypes,
      primaryType: "Claim",
      message: {
        payoutId,
        recipient: bob.account.address,
        action: CLAIM_ACTION,
        version: CLAIM_AUTHORIZATION_VERSION,
      },
    });

    // Claim must revert due to expiration
    await assert.rejects(async () => {
      await mine(
        vault.write.claim(
          [payoutId, bob.account.address, signature],
          { account: bob.account },
        ),
      );
    });
  });
});

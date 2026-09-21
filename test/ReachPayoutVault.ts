import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { bytesToHex, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const { viem, networkHelpers } = await network.create();
const publicClient = await viem.getPublicClient();
const [sender, alice, attacker, relayer, secondRelayer] = await viem.getWalletClients();

const CLAIM_ACTION = keccak256(toHex("ReachPayoutVault.claim"));
const CLAIM_TYPES = {
  Claim: [
    { name: "payoutId", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "action", type: "bytes32" },
    { name: "version", type: "uint256" },
  ],
} as const;

type Contract = any;
type ClaimKey = { privateKey: Hex; account: ReturnType<typeof privateKeyToAccount> };
type Fixture = {
  token: Contract;
  vault: Contract;
  sender: any;
  alice: any;
  attacker: any;
  relayer: any;
};

function newClaimKey(): ClaimKey {
  const privateKey = bytesToHex(randomBytes(32));
  return { privateKey, account: privateKeyToAccount(privateKey) };
}

async function mine(transaction: Promise<Hex>): Promise<any> {
  const hash = await transaction;
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") throw new Error(`transaction reverted: ${hash}`);
  return receipt;
}

async function expectRevert(action: () => Promise<unknown>): Promise<void> {
  await assert.rejects(action);
}

async function deploy(): Promise<Fixture> {
  const token = await viem.deployContract("MockTIP20");
  const vault = await viem.deployContract("ReachPayoutVault", [token.address]);
  await mine(token.write.mint([sender.account.address, 1_000_000n], { account: sender.account }));
  return { token, vault, sender, alice, attacker, relayer };
}

async function funded(
  fixture: Fixture,
  options: { payoutId?: bigint; amount?: bigint; expiryOffset?: bigint; claimKey?: ClaimKey } = {},
) {
  const payoutId = options.payoutId ?? 1n;
  const amount = options.amount ?? 100n;
  const expiryOffset = options.expiryOffset ?? 3600n;
  const claimKey = options.claimKey ?? newClaimKey();
  const expiresAt = BigInt(await networkHelpers.time.latest()) + expiryOffset;
  await mine(fixture.token.write.approve([fixture.vault.address, amount], { account: sender.account }));
  await mine(
    fixture.vault.write.createPayout(
      [payoutId, amount, claimKey.account.address, expiresAt],
      { account: sender.account },
    ),
  );
  return { ...fixture, payoutId, amount, expiresAt, claimKey };
}

async function readPayout(vault: Contract, payoutId: bigint): Promise<any> {
  return vault.read.getPayout([payoutId]);
}

async function signClaim(
  key: ClaimKey,
  vault: Address,
  payoutId: bigint,
  recipient: Address,
  chainId?: number,
): Promise<Hex> {
  const typedChainId = chainId ?? (await publicClient.getChainId());
  return key.account.signTypedData({
    domain: {
      name: "Reach Payout Vault",
      version: "1",
      chainId: typedChainId,
      verifyingContract: vault,
    },
    types: CLAIM_TYPES,
    primaryType: "Claim",
    message: { payoutId, recipient, action: CLAIM_ACTION, version: 1n },
  } as any);
}

async function claimAs(
  fixture: Fixture,
  account: any,
  payoutId: bigint,
  recipient: Address,
  signature: Hex,
) {
  return mine(fixture.vault.write.claim([payoutId, recipient, signature], { account }));
}

describe("ReachPayoutVault — Phase 1 authorization and accounting", async () => {
  it("creates and funds the exact payout amount atomically", async () => {
    const fixture = await funded(await deploy(), { amount: 125n });
    const stored = await readPayout(fixture.vault, fixture.payoutId);
    assert.equal(stored.sender.toLowerCase(), sender.account.address.toLowerCase());
    assert.equal(stored.amount, 125n);
    assert.equal(stored.claimSigner.toLowerCase(), fixture.claimKey.account.address.toLowerCase());
    assert.equal(Number(stored.status), 1);
    assert.equal(await fixture.token.read.balanceOf([fixture.vault.address]), 125n);
    assert.equal(await fixture.vault.read.totalFundedAmount(), 125n);
  });

  it("rejects insufficient allowance without creating a FUNDED record", async () => {
    const f = await deploy();
    const key = newClaimKey();
    const expiry = BigInt(await networkHelpers.time.latest()) + 3600n;
    await mine(f.token.write.approve([f.vault.address, 99n], { account: sender.account }));
    await expectRevert(() => mine(f.vault.write.createPayout([1n, 100n, key.account.address, expiry], { account: sender.account })));
    assert.equal(Number((await readPayout(f.vault, 1n)).status), 0);
    assert.equal(await f.token.read.balanceOf([f.vault.address]), 0n);
  });

  it("rejects insufficient sender balance", async () => {
    const f = await deploy();
    const key = newClaimKey();
    const expiry = BigInt(await networkHelpers.time.latest()) + 3600n;
    await mine(f.token.write.approve([f.vault.address, 1_000_001n], { account: sender.account }));
    await expectRevert(() => mine(f.vault.write.createPayout([1n, 1_000_001n, key.account.address, expiry], { account: sender.account })));
    assert.equal(Number((await readPayout(f.vault, 1n)).status), 0);
  });

  it("rejects payout ID reuse", async () => {
    const f = await funded(await deploy());
    const key = newClaimKey();
    await mine(f.token.write.approve([f.vault.address, 100n], { account: sender.account }));
    await expectRevert(() => mine(f.vault.write.createPayout([1n, 100n, key.account.address, f.expiresAt + 1000n], { account: sender.account })));
  });

  it("rejects zero amount", async () => {
    const f = await deploy();
    const key = newClaimKey();
    const expiry = BigInt(await networkHelpers.time.latest()) + 3600n;
    await mine(f.token.write.approve([f.vault.address, 1n], { account: sender.account }));
    await expectRevert(() => mine(f.vault.write.createPayout([1n, 0n, key.account.address, expiry], { account: sender.account })));
  });

  it("rejects an invalid claim signer", async () => {
    const f = await deploy();
    const expiry = BigInt(await networkHelpers.time.latest()) + 3600n;
    await mine(f.token.write.approve([f.vault.address, 1n], { account: sender.account }));
    await expectRevert(() => mine(f.vault.write.createPayout([1n, 1n, "0x0000000000000000000000000000000000000000", expiry], { account: sender.account })));
  });

  it("accepts a correct claim authorization before expiry", async () => {
    const f = await funded(await deploy());
    const signature = await signClaim(f.claimKey, f.vault.address, f.payoutId, alice.account.address);
    await claimAs(f, relayer.account, f.payoutId, alice.account.address, signature);
    const stored = await readPayout(f.vault, f.payoutId);
    assert.equal(Number(stored.status), 2);
    assert.equal(stored.claimant.toLowerCase(), alice.account.address.toLowerCase());
  });

  it("transfers the exact amount to the signed recipient", async () => {
    const f = await funded(await deploy(), { amount: 321n });
    const before = await f.token.read.balanceOf([alice.account.address]);
    const signature = await signClaim(f.claimKey, f.vault.address, f.payoutId, alice.account.address);
    await claimAs(f, relayer.account, f.payoutId, alice.account.address, signature);
    assert.equal(await f.token.read.balanceOf([alice.account.address]), before + 321n);
    assert.equal(await f.token.read.balanceOf([f.vault.address]), 0n);
  });

  it("rejects the wrong key or signature", async () => {
    const f = await funded(await deploy());
    const signature = await signClaim(newClaimKey(), f.vault.address, f.payoutId, alice.account.address);
    await expectRevert(() => claimAs(f, relayer.account, f.payoutId, alice.account.address, signature));
    assert.equal(Number((await readPayout(f.vault, f.payoutId)).status), 1);
  });

  it("rejects a signature for payout A when presented for payout B", async () => {
    const f = await deploy();
    const key = newClaimKey();
    const a = await funded(f, { payoutId: 1n, claimKey: key });
    const b = await funded(a, { payoutId: 2n, claimKey: key });
    const signatureForA = await signClaim(key, b.vault.address, 1n, alice.account.address);
    await expectRevert(() => claimAs(b, relayer.account, 2n, alice.account.address, signatureForA));
    assert.equal(Number((await readPayout(b.vault, 2n)).status), 1);
  });

  it("rejects a signature bound to contract A when used on contract B", async () => {
    const f = await deploy();
    const vaultB = await viem.deployContract("ReachPayoutVault", [f.token.address]);
    const key = newClaimKey();
    const a = await funded(f, { payoutId: 1n, claimKey: key });
    await mine(f.token.write.approve([vaultB.address, 100n], { account: sender.account }));
    await mine(vaultB.write.createPayout([1n, 100n, key.account.address, a.expiresAt], { account: sender.account }));
    const signatureForA = await signClaim(key, a.vault.address, 1n, alice.account.address);
    await expectRevert(() => mine(vaultB.write.claim([1n, alice.account.address, signatureForA], { account: relayer.account })));
    assert.equal(Number((await readPayout(vaultB, 1n)).status), 1);
  });

  it("rejects a signature from the wrong EIP-712 chain domain", async () => {
    const f = await funded(await deploy());
    const signature = await signClaim(f.claimKey, f.vault.address, f.payoutId, alice.account.address, (await publicClient.getChainId()) + 1);
    await expectRevert(() => claimAs(f, relayer.account, f.payoutId, alice.account.address, signature));
  });

  it("enforces that the signed recipient cannot be changed", async () => {
    const f = await funded(await deploy());
    const signatureForAlice = await signClaim(f.claimKey, f.vault.address, f.payoutId, alice.account.address);
    await expectRevert(() => claimAs(f, attacker.account, f.payoutId, attacker.account.address, signatureForAlice));
    assert.equal(Number((await readPayout(f.vault, f.payoutId)).status), 1);
  });

  it("proves a copied exact authorization cannot redirect funds", async () => {
    const f = await funded(await deploy(), { amount: 777n });
    const signatureForAlice = await signClaim(f.claimKey, f.vault.address, f.payoutId, alice.account.address);
    await claimAs(f, attacker.account, f.payoutId, alice.account.address, signatureForAlice);
    assert.equal(await f.token.read.balanceOf([alice.account.address]), 777n);
    assert.equal(await f.token.read.balanceOf([attacker.account.address]), 0n);
  });

  it("makes duplicate claim impossible", async () => {
    const f = await funded(await deploy());
    const signature = await signClaim(f.claimKey, f.vault.address, f.payoutId, alice.account.address);
    await claimAs(f, relayer.account, f.payoutId, alice.account.address, signature);
    await expectRevert(() => claimAs(f, attacker.account, f.payoutId, alice.account.address, signature));
    assert.equal(await f.token.read.balanceOf([alice.account.address]), 100n);
  });

  it("rejects claim at and after expiry", async () => {
    const f = await funded(await deploy(), { expiryOffset: 30n });
    await networkHelpers.time.increaseTo(f.expiresAt);
    const signature = await signClaim(f.claimKey, f.vault.address, f.payoutId, alice.account.address);
    await expectRevert(() => claimAs(f, relayer.account, f.payoutId, alice.account.address, signature));
    assert.equal(Number((await readPayout(f.vault, f.payoutId)).status), 1);
  });

  it("rejects reclaim before expiry", async () => {
    const f = await funded(await deploy());
    await expectRevert(() => mine(f.vault.write.reclaim([f.payoutId], { account: sender.account })));
    assert.equal(Number((await readPayout(f.vault, f.payoutId)).status), 1);
  });

  it("allows sender reclaim at or after expiry", async () => {
    const f = await funded(await deploy(), { amount: 222n, expiryOffset: 30n });
    await networkHelpers.time.increaseTo(f.expiresAt);
    const before = await f.token.read.balanceOf([sender.account.address]);
    await mine(f.vault.write.reclaim([f.payoutId], { account: sender.account }));
    assert.equal(Number((await readPayout(f.vault, f.payoutId)).status), 3);
    assert.equal(await f.token.read.balanceOf([sender.account.address]), before + 222n);
  });

  it("rejects non-sender reclaim", async () => {
    const f = await funded(await deploy(), { expiryOffset: 30n });
    await networkHelpers.time.increaseTo(f.expiresAt);
    await expectRevert(() => mine(f.vault.write.reclaim([f.payoutId], { account: attacker.account })));
  });

  it("rejects claim after reclaim", async () => {
    const f = await funded(await deploy(), { expiryOffset: 30n });
    await networkHelpers.time.increaseTo(f.expiresAt);
    await mine(f.vault.write.reclaim([f.payoutId], { account: sender.account }));
    const signature = await signClaim(f.claimKey, f.vault.address, f.payoutId, alice.account.address);
    await expectRevert(() => claimAs(f, relayer.account, f.payoutId, alice.account.address, signature));
  });

  it("rejects reclaim after claim", async () => {
    const f = await funded(await deploy());
    const signature = await signClaim(f.claimKey, f.vault.address, f.payoutId, alice.account.address);
    await claimAs(f, relayer.account, f.payoutId, alice.account.address, signature);
    await expectRevert(() => mine(f.vault.write.reclaim([f.payoutId], { account: sender.account })));
  });

  it("allows exactly one winner when two claim attempts race", async () => {
    const f = await funded(await deploy());
    const signature = await signClaim(f.claimKey, f.vault.address, f.payoutId, alice.account.address);
    const outcomes = await Promise.allSettled([
      claimAs(f, relayer.account, f.payoutId, alice.account.address, signature),
      claimAs(f, secondRelayer.account, f.payoutId, alice.account.address, signature),
    ]);
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
    assert.equal(Number((await readPayout(f.vault, f.payoutId)).status), 2);
    assert.equal(await f.token.read.balanceOf([alice.account.address]), 100n);
  });

  it("does not leave a false terminal state when token transfer returns false", async () => {
    const f = await funded(await deploy());
    await mine(f.token.write.setReturnFalseOnTransfer([true]));
    const signature = await signClaim(f.claimKey, f.vault.address, f.payoutId, alice.account.address);
    await expectRevert(() => claimAs(f, relayer.account, f.payoutId, alice.account.address, signature));
    assert.equal(Number((await readPayout(f.vault, f.payoutId)).status), 1);
    assert.equal(await f.vault.read.totalFundedAmount(), 100n);
    assert.equal(await f.token.read.balanceOf([f.vault.address]), 100n);
  });

  it("keeps live vault balance equal to the sum of FUNDED payouts", async () => {
    const f = await deploy();
    const first = await funded(f, { payoutId: 1n, amount: 100n, expiryOffset: 30n });
    const second = await funded(first, { payoutId: 2n, amount: 200n, expiryOffset: 30n });
    const third = await funded(second, { payoutId: 3n, amount: 300n, expiryOffset: 3600n });
    const signature = await signClaim(first.claimKey, third.vault.address, 1n, alice.account.address);
    await claimAs(third, relayer.account, 1n, alice.account.address, signature);
    await networkHelpers.time.increaseTo(second.expiresAt);
    await mine(third.vault.write.reclaim([2n], { account: sender.account }));
    assert.equal(Number((await readPayout(third.vault, 3n)).status), 1);
    assert.equal(await third.vault.read.totalFundedAmount(), 300n);
    assert.equal(await third.token.read.balanceOf([third.vault.address]), 300n);
  });

  it("never places the raw claim private key in claim calldata", async () => {
    const f = await funded(await deploy());
    const signature = await signClaim(f.claimKey, f.vault.address, f.payoutId, alice.account.address);
    const hash = await f.vault.write.claim([f.payoutId, alice.account.address, signature], { account: relayer.account });
    const transaction = await publicClient.getTransaction({ hash });
    assert.equal(transaction.input.toLowerCase().includes(f.claimKey.privateKey.slice(2).toLowerCase()), false);
  });
});

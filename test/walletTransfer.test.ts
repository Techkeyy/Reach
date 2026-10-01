import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeAbiParameters, keccak256, toHex } from "viem";
import { PATH_USD_ADDRESS, pathUsdAbi } from "../src/shared/reach";
import { validateWalletTransferInput, walletTransferCall, walletTransferEventAbi, walletTransferRequest, readWalletTransferAuthority, type WalletTransferIntent } from "../src/client/walletTransfer";
import { activityFromWalletTransfer, activityLabel } from "../src/client/activity";
import { submitAndReconcile } from "../src/client/submitAndReconcile";

const sender = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222" as const;
const amount = 1_250_000n;

test("wallet transfer validation rejects invalid, zero, self, and insufficient destinations", () => {
  assert.throws(() => validateWalletTransferInput({ sender, recipient: "nope", amount: "1", balance: "1000000" }), /valid Tempo/);
  assert.throws(() => validateWalletTransferInput({ sender, recipient: "0x0000000000000000000000000000000000000000", amount: "1", balance: "1000000" }), /zero address/);
  assert.throws(() => validateWalletTransferInput({ sender, recipient: sender, amount: "1", balance: "1000000" }), /different wallet/);
  assert.throws(() => validateWalletTransferInput({ sender, recipient, amount: "0", balance: "1000000" }), /greater than 0/);
  assert.throws(() => validateWalletTransferInput({ sender, recipient, amount: "2", balance: "1000000" }), /exceeds/);
});

test("wallet transfer encodes a direct TIP-20 transfer and account-paid fee request", () => {
  const call = walletTransferCall(recipient, amount);
  const decoded = decodeFunctionData({ abi: pathUsdAbi, data: call.data });
  assert.equal(call.to, PATH_USD_ADDRESS);
  assert.equal(decoded.functionName, "transfer");
  assert.deepEqual(decoded.args, [recipient, amount]);
  assert.equal(walletTransferRequest(recipient, amount).feePayer, false);
});

test("wallet transfer confirms only from a matching public Transfer event", async () => {
  const intent: WalletTransferIntent = {
    operationId: "wallet-transfer:test",
    sender,
    recipient,
    amount: amount.toString(),
    createdAt: new Date(0).toISOString(),
    fromBlock: 10n,
    baselineSenderBalance: "5000000",
    baselineRecipientBalance: "1000000",
  };
  const encoded = {
    topics: [
      keccak256(toHex("Transfer(address,address,uint256)")),
      `0x${sender.slice(2).padStart(64, "0")}` as `0x${string}`,
      `0x${recipient.slice(2).padStart(64, "0")}` as `0x${string}`,
    ],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  };
  const client = {
    getTransactionReceipt: async () => ({ status: "success", logs: [{ data: encoded.data, topics: encoded.topics }] }),
    readContract: async ({ args }: { args: [string] }) => args[0].toLowerCase() === sender.toLowerCase() ? 3_750_000n : 2_250_000n,
    getLogs: async () => [],
  };
  const authority = await readWalletTransferAuthority(client, intent, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(authority.confirmed, true);
  assert.equal(authority.transferEvent, true);
  assert.equal(authority.receiptStatus, "success");
});

test("wallet transfer activity is a sent direct transfer, not a Reach payout", () => {
  const activity = activityFromWalletTransfer({
    operationId: "wallet-transfer:activity",
    sender,
    recipient,
    amount: amount.toString(),
    createdAt: new Date(0).toISOString(),
    state: "CONFIRMED",
  });
  assert.equal(activity.kind, "WALLET_TRANSFER");
  assert.equal(activity.direction, "SENT");
  assert.equal(activity.recipient, recipient);
  assert.equal(activityLabel(activity), "Sent to wallet");
});

test("wallet transfer can confirm from exact resulting balances when receipt is unavailable", async () => {
  const intent: WalletTransferIntent = {
    operationId: "wallet-transfer:balances",
    sender,
    recipient,
    amount: amount.toString(),
    createdAt: new Date(0).toISOString(),
    fromBlock: 10n,
    baselineSenderBalance: "5000000",
    baselineRecipientBalance: "1000000",
  };
  const client = {
    getTransactionReceipt: async () => { throw new Error("not indexed yet"); },
    readContract: async ({ args }: { args: [string] }) => args[0].toLowerCase() === sender.toLowerCase() ? 3_750_000n : 2_250_000n,
    getLogs: async () => [],
  };
  const authority = await readWalletTransferAuthority(client, intent, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(authority.confirmed, true);
  assert.equal(authority.transferEvent, false);
});

const journalOperation = {
  operationType: "WALLET_TRANSFER" as const,
  operationId: "wallet-transfer:recovery",
  payoutIds: [],
  expectedSender: sender,
  expectedRecipient: recipient,
  expectedAmount: amount.toString(),
  createdAt: new Date(0).toISOString(),
  submissionBoundaryReached: false,
  state: "PREPARED" as const,
};

test("wallet transfer preserves safe terminal states across provider failure modes", async () => {
  const noWait = async () => {};
  const preSubmit = await submitAndReconcile({
    operation: journalOperation,
    prepare: async () => { throw new Error("preflight failed"); },
    submit: async () => { throw new Error("must not submit"); },
    readAuthoritativeState: async () => undefined,
    successPredicate: () => false,
    sleep: noWait,
    messages: { failedBeforeSubmission: "No transfer was submitted." },
  });
  assert.equal(preSubmit.outcome, "FAILED_BEFORE_SUBMISSION");

  let submitCount = 0;
  const responseLoss = await submitAndReconcile({
    operation: journalOperation,
    submit: async () => { submitCount += 1; throw new Error("provider response lost"); },
    readAuthoritativeState: async () => ({ confirmed: true }),
    successPredicate: value => value.confirmed,
    sleep: noWait,
    reconcileAttempts: 1,
  });
  assert.equal(responseLoss.outcome, "CONFIRMED");
  assert.equal(submitCount, 1);

  const delayedReceipt = await submitAndReconcile({
    operation: journalOperation,
    submit: async () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    extractHash: value => value as string,
    waitForReceipt: async () => { throw new Error("receipt delayed"); },
    readAuthoritativeState: async () => ({ confirmed: true }),
    successPredicate: value => value.confirmed,
    sleep: noWait,
    reconcileAttempts: 1,
  });
  assert.equal(delayedReceipt.outcome, "CONFIRMED");

  const reverted = await submitAndReconcile({
    operation: journalOperation,
    submit: async () => "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    extractHash: value => value as string,
    waitForReceipt: async () => ({ status: "reverted" as const }),
    readAuthoritativeState: async () => ({ confirmed: true }),
    successPredicate: value => value.confirmed,
    sleep: noWait,
  });
  assert.equal(reverted.outcome, "FAILED");
});

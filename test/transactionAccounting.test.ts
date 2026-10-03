import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, Hex } from "viem";
import { actualFeeAmountFromGas } from "../src/shared/transactionAccounting";
import { recoverConfirmedTransactionAccounting, type AccountingReader } from "../src/server/transactionAccounting";

const sender = "0x6B6e9e45Cf4bB5CbC7d4a8B19cf3d886369Ff925" as Address;
const pathUsd = "0x20c0000000000000000000000000000000000000" as Address;
const alternate = "0x0000000000000000000000000000000000000002" as Address;
const txHash = "0x2d595645455ad01c73ed22729022fb4d0a61aba43596639be98640845c13f390" as Hex;

function reader(overrides: Partial<AccountingReader> = {}): AccountingReader {
  return {
    getChainId: async () => 42431,
    getTransaction: async () => ({ hash: txHash, from: sender, chainId: 42431, to: pathUsd }),
    getTransactionReceipt: async () => ({ transactionHash: txHash, status: "success", gasUsed: 828488n, effectiveGasPrice: 600000001n, feeToken: pathUsd, from: sender }),
    readContract: async ({ functionName }) => functionName === "decimals" ? 6 : "pathUSD",
    ...overrides,
  };
}

test("recovers the historical pathUSD receipt fee without using the estimate", async () => {
  const accounting = await recoverConfirmedTransactionAccounting(reader(), txHash, { expectedSender: sender });
  assert.deepEqual(accounting, {
    txHash,
    receiptStatus: "success",
    feeToken: pathUsd,
    feeTokenDecimals: 6,
    feeTokenSymbol: "pathUSD",
    actualFeeAmount: "497",
    gasUsed: "828488",
    effectiveGasPrice: "600000001",
  });
  assert.equal(actualFeeAmountFromGas(828488n, 600000001n, 6), 497n);
});

test("receipt unavailable does not create accounting evidence", async () => {
  const accounting = await recoverConfirmedTransactionAccounting(reader({
    getTransactionReceipt: async () => { throw new Error("receipt unavailable"); },
  }), txHash);
  assert.equal(accounting, null);
});

test("transaction unavailable does not create accounting evidence", async () => {
  const accounting = await recoverConfirmedTransactionAccounting(reader({ getTransaction: async () => null }), txHash);
  assert.equal(accounting, null);
});

test("reverted receipts do not create confirmed accounting evidence", async () => {
  const accounting = await recoverConfirmedTransactionAccounting(reader({
    getTransactionReceipt: async () => ({ transactionHash: txHash, status: "reverted", gasUsed: 10n, effectiveGasPrice: 20n, feeToken: pathUsd }),
  }), txHash);
  assert.equal(accounting, null);
});

test("alternate fee tokens use the receipt token and its authoritative decimals", async () => {
  const accounting = await recoverConfirmedTransactionAccounting(reader({
    getTransaction: async () => ({ hash: txHash, from: sender, chainId: 42431, to: alternate, feeToken: alternate }),
    getTransactionReceipt: async () => ({ transactionHash: txHash, status: "success", gasUsed: 7n, effectiveGasPrice: 1n, feeToken: alternate }),
    readContract: async ({ functionName }) => functionName === "decimals" ? 18 : "ALT",
  }), txHash, { expectedSender: sender });
  assert.equal(accounting?.feeToken, alternate);
  assert.equal(accounting?.feeTokenDecimals, 18);
  assert.equal(accounting?.feeTokenSymbol, "ALT");
  assert.equal(accounting?.actualFeeAmount, "7");
});

test("malformed receipt data, wrong chain, and wrong sender are unavailable", async () => {
  const malformed = await recoverConfirmedTransactionAccounting(reader({
    getTransactionReceipt: async () => ({ transactionHash: txHash, status: "success", gasUsed: "not-a-number", effectiveGasPrice: 20n, feeToken: pathUsd }),
  }), txHash);
  assert.equal(malformed, null);

  const wrongChain = await recoverConfirmedTransactionAccounting(reader({ getChainId: async () => 1 }), txHash);
  assert.equal(wrongChain, null);

  const wrongSender = await recoverConfirmedTransactionAccounting(reader({
    getTransaction: async () => ({ hash: txHash, from: alternate, chainId: 42431, to: pathUsd }),
  }), txHash, { expectedSender: sender });
  assert.equal(wrongSender, null);
});

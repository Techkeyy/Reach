import assert from "node:assert/strict";
import { test } from "node:test";
import { PATH_USD_ADDRESS } from "../src/shared/reach";
import { actualFeeFromReceipt, buildFinancialQuote, parsePreflightFeeEvidence, requireAffordableQuote } from "../src/client/financialQuote";
import { FinancialError } from "../src/client/financialErrors";

const otherFeeToken = "0x3000000000000000000000000000000000000000" as const;

test("fee-aware quote includes same-token fee in total and remaining balance", () => {
  const quote = buildFinancialQuote({
    availableBalance: 10_000_000n,
    sendAmount: 1_250_000n,
    fee: { amount: 1_000n, decimals: 6, symbol: "pathUSD", token: PATH_USD_ADDRESS },
  });
  assert.equal(quote.affordabilityStatus, "AFFORDABLE");
  assert.equal(quote.estimatedTotalDebit[0].amount, 1_251_000n);
  assert.equal(quote.estimatedRemainingBalance?.amount, 8_749_000n);
});

test("different fee token requires and checks a separate fee balance", () => {
  const quote = buildFinancialQuote({
    availableBalance: 10_000_000n,
    sendAmount: 1_250_000n,
    fee: { amount: 2n, decimals: 6, symbol: "USD", token: otherFeeToken },
    feeTokenBalance: 1n,
  });
  assert.equal(quote.affordabilityStatus, "INSUFFICIENT_FEE_BALANCE");
  assert.throws(() => requireAffordableQuote(quote), (error: unknown) => error instanceof FinancialError && error.code === "INSUFFICIENT_FEE_BALANCE");
});

test("missing Tempo fee capability is unavailable, never assumed zero", () => {
  const quote = buildFinancialQuote({ availableBalance: 10_000_000n, sendAmount: 1_250_000n, fee: null });
  assert.equal(quote.feeStatus, "UNAVAILABLE");
  assert.equal(quote.affordabilityStatus, "UNKNOWN");
  assert.throws(() => requireAffordableQuote(quote), (error: unknown) => error instanceof FinancialError && error.code === "FEE_ESTIMATE_UNAVAILABLE");
});

test("preflight fee metadata and confirmed receipt fee remain distinct", () => {
  const response = { tx: { feeToken: PATH_USD_ADDRESS }, capabilities: { fee: { amount: "0x3e8", decimals: 6, symbol: "pathUSD" } } };
  assert.deepEqual(parsePreflightFeeEvidence(response), { amount: 1_000n, decimals: 6, symbol: "pathUSD", token: PATH_USD_ADDRESS });
  const actual = actualFeeFromReceipt({ gasUsed: 100n, effectiveGasPrice: 20_000_000_000n, feeToken: PATH_USD_ADDRESS }, { amount: 1_000n, decimals: 6, symbol: "pathUSD", token: PATH_USD_ADDRESS });
  assert.equal(actual?.amount, 2n);
});

test("fee conversion preserves an exact integer token-unit boundary", () => {
  const response = { tx: { gas: "0x1", maxFeePerGas: "0xe8d4a51000", feeToken: PATH_USD_ADDRESS } };
  assert.equal(parsePreflightFeeEvidence(response)?.amount, 1n);
});

test("fee conversion floors a fractional token-unit result", () => {
  const response = { tx: { gas: "0x1", maxFeePerGas: "0xe8d4a5107b", feeToken: PATH_USD_ADDRESS } };
  assert.equal(parsePreflightFeeEvidence(response)?.amount, 1n);
});

test("fee conversion returns zero just below one token base unit", () => {
  const response = { tx: { gas: "0x1", maxFeePerGas: "0xe8d4a50fff", feeToken: PATH_USD_ADDRESS } };
  assert.equal(parsePreflightFeeEvidence(response)?.amount, 0n);
});

test("fee conversion returns one just above one token base unit", () => {
  const response = { tx: { gas: "0x1", maxFeePerGas: "0xe8d4a51001", feeToken: PATH_USD_ADDRESS } };
  assert.equal(parsePreflightFeeEvidence(response)?.amount, 1n);
});

test("sender-paid fill envelope derives a live pathUSD fee when capability metadata is absent", () => {
  const response = { tx: { gas: "0xed9b", maxFeePerGas: "0x47868c01", feeToken: PATH_USD_ADDRESS } };
  assert.deepEqual(parsePreflightFeeEvidence(response), { amount: 72n, decimals: 6, symbol: "pathUSD", token: PATH_USD_ADDRESS });
});

test("exact pathUSD balance is rejected for fee shortfall and remaining balance floors at zero", () => {
  const quote = buildFinancialQuote({
    availableBalance: 200_000_000n,
    sendAmount: 200_000_000n,
    fee: { amount: 72n, decimals: 6, symbol: "pathUSD", token: PATH_USD_ADDRESS },
  });
  assert.equal(quote.affordabilityStatus, "INSUFFICIENT_FEE_BALANCE");
  assert.equal(quote.estimatedTotalDebit[0].amount, 200_000_072n);
  assert.equal(quote.estimatedRemainingBalance?.amount, 0n);
  assert.throws(() => requireAffordableQuote(quote), (error: unknown) => error instanceof FinancialError && error.code === "INSUFFICIENT_FEE_BALANCE");
});

test("amount shortfall wins before same-token fee shortfall", () => {
  const quote = buildFinancialQuote({
    availableBalance: 200_000_000n,
    sendAmount: 200_000_001n,
    fee: { amount: 72n, decimals: 6, symbol: "pathUSD", token: PATH_USD_ADDRESS },
  });
  assert.equal(quote.affordabilityStatus, "INSUFFICIENT_TRANSFER_BALANCE");
  assert.equal(quote.amountShortfall?.amount, 1n);
});

test("filled transaction without a fee token remains unavailable rather than guessing one", () => {
  assert.equal(parsePreflightFeeEvidence({ tx: { gas: "0xed9b", maxFeePerGas: "0x47868c01", feeToken: null } }), null);
  assert.deepEqual(parsePreflightFeeEvidence({ tx: { gas: "0xed9b", maxFeePerGas: "0x47868c01", feeToken: null } }, PATH_USD_ADDRESS), { amount: 72n, decimals: 6, symbol: "pathUSD", token: PATH_USD_ADDRESS });
});

test("actual receipt fee is lower than the preflight maximum and uses receipt evidence", () => {
  const preflight = parsePreflightFeeEvidence({ tx: { gas: "0xed9b", maxFeePerGas: "0x47868c01", feeToken: PATH_USD_ADDRESS } });
  const actual = actualFeeFromReceipt({ gasUsed: 50n, effectiveGasPrice: 20_000_000_000n, feeToken: PATH_USD_ADDRESS }, preflight && { ...preflight });
  assert.equal(preflight?.amount, 72n);
  assert.equal(actual?.amount, 1n);
  assert.notEqual(actual?.amount, preflight?.amount);
});

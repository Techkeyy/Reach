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
  const actual = actualFeeFromReceipt({ gasUsed: 100n, effectiveGasPrice: 20n, feeToken: PATH_USD_ADDRESS }, { amount: 1_000n, decimals: 6, symbol: "pathUSD", token: PATH_USD_ADDRESS });
  assert.equal(actual?.amount, 2_000n);
});

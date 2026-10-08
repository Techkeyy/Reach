import assert from "node:assert/strict";
import test from "node:test";
import { parsePathUsdAmount } from "../src/client/senderFlow";
import { parseBatchBalanceRaw, validateBatchRows, type BatchRow } from "../src/client/BatchExperience";

function rows(values: Array<Partial<BatchRow>>): BatchRow[] {
  return values.map((value, index) => ({ id: String(index + 1), name: "", amount: "", note: "", ...value }));
}

test("batch draft validation tolerates blank, partial, and invalid amounts without throwing", () => {
  const blank = validateBatchRows(rows([{}, {}, {}]));
  assert.equal(blank.isValid, false);
  assert.deepEqual(blank.errors, {});

  const namesOnly = validateBatchRows(rows([{ name: "Alice" }, { name: "Bob" }, { name: "Cara" }]));
  assert.equal(namesOnly.isValid, false);
  assert.equal(Object.keys(namesOnly.errors).length, 3);

  for (const amount of ["", "0", "0.", "1.", "1.0000001", "not-a-number"]) {
    const result = validateBatchRows(rows([{ name: "Alice", amount }]));
    assert.equal(result.isValid, false);
    assert.ok(result.errors["1"]);
  }
});

test("valid three-recipient batch totals exactly and final parsing stays strict", () => {
  const result = validateBatchRows(rows([
    { name: "Alice", amount: "1.25" },
    { name: "Bob", amount: "2.5" },
    { name: "Cara", amount: "0.000001" },
  ]));

  assert.equal(result.isValid, true);
  assert.equal(result.items.reduce((total, item) => total + item.amountRaw, 0n), 3_750_001n);
  assert.equal(result.items[0].amountRaw, parsePathUsdAmount("1.25"));
  assert.throws(() => parsePathUsdAmount("1.0000001"));
});

test("batch affordability uses raw pathUSD units, not localized display text", () => {
  const result = validateBatchRows(rows([
    { name: "Alice", amount: "5" },
    { name: "Bob", amount: "19" },
    { name: "Cara", amount: "20" },
  ]));
  const totalRaw = result.items.reduce((total, item) => total + item.amountRaw, 0n);

  assert.deepEqual(result.items.map(item => item.amountRaw), [5_000_000n, 19_000_000n, 20_000_000n]);
  assert.equal(totalRaw, 44_000_000n);
  assert.equal(parseBatchBalanceRaw("999730970037") >= totalRaw, true);
  assert.equal(parseBatchBalanceRaw("44000000") >= totalRaw, true);
  assert.equal(parseBatchBalanceRaw("43999999") >= totalRaw, false);
  assert.equal(parseBatchBalanceRaw("999,730.970037"), 0n);
  assert.equal(parseBatchBalanceRaw("999999999999999999999999999999"), 999999999999999999999999999999n);
});

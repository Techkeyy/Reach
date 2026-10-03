import type { Address, Hex } from "viem";

export type AccountingAmount = {
  amount: string;
  decimals: number;
  symbol?: string;
  token: Address;
};

export type ConfirmedTransactionAccounting = {
  txHash: Hex;
  receiptStatus: "success";
  feeToken: Address;
  feeTokenDecimals: number;
  feeTokenSymbol?: string;
  actualFeeAmount: string;
  gasUsed: string;
  effectiveGasPrice: string;
};

export type ConfirmedPayoutAccounting = ConfirmedTransactionAccounting & {
  actualTotalDeducted: AccountingAmount[];
};

/**
 * Tempo gas prices use 18-decimal units while fee tokens use their own
 * decimals. Fee-token accounting is integer base-unit accounting, so the
 * conversion deliberately floors the fractional remainder.
 */
export function feeTokenUnitsFromGasUnits(raw: bigint, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error("invalid fee-token decimals");
  if (decimals === 18) return raw;
  if (decimals < 18) return raw / (10n ** BigInt(18 - decimals));
  return raw * (10n ** BigInt(decimals - 18));
}

export function actualFeeAmountFromGas(gasUsed: bigint, effectiveGasPrice: bigint, decimals: number): bigint {
  if (gasUsed < 0n || effectiveGasPrice < 0n) throw new Error("invalid receipt gas data");
  return feeTokenUnitsFromGasUnits(gasUsed * effectiveGasPrice, decimals);
}

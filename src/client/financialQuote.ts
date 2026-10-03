import { formatUnits, isAddress, type Address } from "viem";
import { PATH_USD_ADDRESS } from "../shared/reach";
import { FinancialError } from "./financialErrors";

export type FinancialAmount = {
  amount: bigint;
  decimals: number;
  symbol: string;
  token?: Address;
};

export type FinancialQuote = {
  availableBalance: FinancialAmount;
  sendAmount: FinancialAmount;
  recipientAmount: FinancialAmount;
  estimatedFeeAmount: FinancialAmount | null;
  estimatedFeeToken: Address | null;
  estimatedTotalDebit: FinancialAmount[];
  estimatedRemainingBalance: FinancialAmount | null;
  feeStatus: "ESTIMATED" | "UNAVAILABLE";
  affordabilityStatus: "AFFORDABLE" | "INSUFFICIENT_TRANSFER_BALANCE" | "INSUFFICIENT_FEE_BALANCE" | "UNKNOWN";
  amountShortfall?: FinancialAmount;
};

export type PreflightFeeEvidence = {
  amount: bigint;
  decimals: number;
  symbol: string;
  token: Address | null;
};

function bigintField(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "bigint" && typeof value !== "number") return null;
  try { return BigInt(value); } catch { return null; }
}

function feeTokenUnitsFromGasUnits(raw: bigint, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error("invalid fee-token decimals");
  if (decimals === 18) return raw;
  if (decimals < 18) return raw / (10n ** BigInt(18 - decimals));
  return raw * (10n ** BigInt(decimals - 18));
}

function feeFromFilledTransaction(tx: Record<string, unknown>, token: Address | null): PreflightFeeEvidence | null {
  if (!token) return null;
  const gas = bigintField(tx.gas);
  const maxFeePerGas = bigintField(tx.maxFeePerGas ?? tx.gasPrice);
  if (gas === null || maxFeePerGas === null || gas < 0n || maxFeePerGas < 0n) return null;

  // Tempo gas prices are expressed with 18 decimals while TIP-20 fee tokens
  // use their token decimals. The current Accounts SDK and Tempo fee path
  // use integer division here, so this is an authoritative floor conversion.
  // The fill still supplies a conservative maximum requirement because it uses
  // the gas limit and maxFeePerGas rather than gasUsed and effectiveGasPrice.
  const decimals = token.toLowerCase() === PATH_USD_ADDRESS.toLowerCase() ? 6 : null;
  if (decimals === null) return null;
  return {
    amount: feeTokenUnitsFromGasUnits(gas * maxFeePerGas, decimals),
    decimals,
    symbol: "pathUSD",
    token,
  };
}

export function actualFeeFromReceipt(receipt: unknown, estimated?: FinancialAmount | null): FinancialAmount | null {
  if (!receipt || typeof receipt !== "object") return null;
  const value = receipt as Record<string, unknown>;
  if (typeof value.gasUsed !== "string" && typeof value.gasUsed !== "bigint") return null;
  if (typeof value.effectiveGasPrice !== "string" && typeof value.effectiveGasPrice !== "bigint") return null;
  try {
    const gasUsed = BigInt(value.gasUsed as string | bigint);
    const effectiveGasPrice = BigInt(value.effectiveGasPrice as string | bigint);
    const feeToken = typeof value.feeToken === "string" && isAddress(value.feeToken) ? value.feeToken as Address : estimated?.token;
    if (!estimated && !feeToken) return null;
    const decimals = estimated?.decimals ?? 6;
    return {
      amount: feeTokenUnitsFromGasUnits(gasUsed * effectiveGasPrice, decimals),
      decimals,
      symbol: estimated?.symbol ?? "fee token",
      ...(feeToken ? { token: feeToken } : {}),
    };
  } catch {
    return null;
  }
}

export function formatFinancialAmount(value: FinancialAmount | null | undefined): string {
  if (!value) return "—";
  return formatUnits(value.amount, value.decimals);
}

function amountLike(value: bigint, decimals: number, symbol: string, token?: Address): FinancialAmount {
  return { amount: value, decimals, symbol, ...(token ? { token } : {}) };
}

export function parsePreflightFeeEvidence(response: unknown, fallbackToken?: Address): PreflightFeeEvidence | null {
  if (!response || typeof response !== "object") return null;
  const root = response as { capabilities?: unknown; tx?: unknown };
  const capabilities = root.capabilities && typeof root.capabilities === "object" ? root.capabilities as Record<string, unknown> : null;
  const fee = capabilities?.fee && typeof capabilities.fee === "object" ? capabilities.fee as Record<string, unknown> : null;
  const tx = root.tx && typeof root.tx === "object" ? root.tx as Record<string, unknown> : null;
  const token = typeof tx?.feeToken === "string" && isAddress(tx.feeToken) ? tx.feeToken as Address : fallbackToken ?? null;
  if (fee && typeof fee.amount === "string" && typeof fee.decimals === "number" && typeof fee.symbol === "string") {
    let amount: bigint;
    try { amount = BigInt(fee.amount); } catch { return null; }
    return { amount, decimals: fee.decimals, symbol: fee.symbol, token };
  }

  return tx ? feeFromFilledTransaction(tx, token) : null;
}

export function buildFinancialQuote(input: {
  availableBalance: bigint;
  sendAmount: bigint;
  fee: PreflightFeeEvidence | null;
  feeTokenBalance?: bigint;
  sendSymbol?: string;
}): FinancialQuote {
  const sendToken = PATH_USD_ADDRESS as Address;
  const send = amountLike(input.sendAmount, 6, input.sendSymbol ?? "pathUSD", sendToken);
  const available = amountLike(input.availableBalance, 6, input.sendSymbol ?? "pathUSD", sendToken);
  if (!input.fee) {
    return {
      availableBalance: available,
      sendAmount: send,
      recipientAmount: send,
      estimatedFeeAmount: null,
      estimatedFeeToken: null,
      estimatedTotalDebit: [send],
      estimatedRemainingBalance: null,
      feeStatus: "UNAVAILABLE",
      affordabilityStatus: "UNKNOWN",
    };
  }

  const fee = amountLike(input.fee.amount, input.fee.decimals, input.fee.symbol, input.fee.token ?? undefined);
  const sameToken = Boolean(input.fee.token && input.fee.token.toLowerCase() === sendToken.toLowerCase());
  const transferShortfall = input.sendAmount > input.availableBalance ? input.sendAmount - input.availableBalance : 0n;
  if (transferShortfall > 0n) {
    return {
      availableBalance: available,
      sendAmount: send,
      recipientAmount: send,
      estimatedFeeAmount: fee,
      estimatedFeeToken: input.fee.token,
      estimatedTotalDebit: [send, fee],
      estimatedRemainingBalance: amountLike(0n, 6, send.symbol, sendToken),
      feeStatus: "ESTIMATED",
      affordabilityStatus: "INSUFFICIENT_TRANSFER_BALANCE",
      amountShortfall: amountLike(transferShortfall, 6, send.symbol, sendToken),
    };
  }

  if (sameToken) {
    const total = input.sendAmount + input.fee.amount;
    const remaining = input.availableBalance >= total ? input.availableBalance - total : 0n;
    return {
      availableBalance: available,
      sendAmount: send,
      recipientAmount: send,
      estimatedFeeAmount: fee,
      estimatedFeeToken: input.fee.token,
      estimatedTotalDebit: [amountLike(total, 6, send.symbol, sendToken)],
      estimatedRemainingBalance: amountLike(remaining, 6, send.symbol, sendToken),
      feeStatus: "ESTIMATED",
      affordabilityStatus: input.availableBalance >= total ? "AFFORDABLE" : "INSUFFICIENT_FEE_BALANCE",
    };
  }

  if (input.fee.token === null || input.feeTokenBalance === undefined) {
    return {
      availableBalance: available,
      sendAmount: send,
      recipientAmount: send,
      estimatedFeeAmount: fee,
      estimatedFeeToken: input.fee.token,
      estimatedTotalDebit: [send, fee],
      estimatedRemainingBalance: amountLike(input.availableBalance - input.sendAmount, 6, send.symbol, sendToken),
      feeStatus: "UNAVAILABLE",
      affordabilityStatus: "UNKNOWN",
    };
  }

  return {
    availableBalance: available,
    sendAmount: send,
    recipientAmount: send,
    estimatedFeeAmount: fee,
    estimatedFeeToken: input.fee.token,
    estimatedTotalDebit: [send, fee],
    estimatedRemainingBalance: amountLike(input.availableBalance - input.sendAmount, 6, send.symbol, sendToken),
    feeStatus: "ESTIMATED",
    affordabilityStatus: input.feeTokenBalance >= input.fee.amount ? "AFFORDABLE" : "INSUFFICIENT_FEE_BALANCE",
  };
}

export function requireAffordableQuote(quote: FinancialQuote): FinancialQuote {
  if (quote.feeStatus === "UNAVAILABLE" || quote.affordabilityStatus === "UNKNOWN") throw new FinancialError("FEE_ESTIMATE_UNAVAILABLE");
  if (quote.affordabilityStatus === "INSUFFICIENT_TRANSFER_BALANCE") throw new FinancialError("INSUFFICIENT_TRANSFER_BALANCE");
  if (quote.affordabilityStatus === "INSUFFICIENT_FEE_BALANCE") throw new FinancialError("INSUFFICIENT_FEE_BALANCE");
  return quote;
}

export function quoteChanged(a: FinancialQuote | null | undefined, b: FinancialQuote): boolean {
  if (!a || !a.estimatedFeeAmount || !b.estimatedFeeAmount) return Boolean(a !== b);
  return a.estimatedFeeAmount.amount !== b.estimatedFeeAmount.amount
    || a.estimatedFeeAmount.token?.toLowerCase() !== b.estimatedFeeAmount.token?.toLowerCase()
    || a.sendAmount.amount !== b.sendAmount.amount;
}

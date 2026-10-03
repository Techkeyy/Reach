import { isAddress, parseAbi, type Address, type Hex } from "viem";
import { TEMPO_MODERATO_CHAIN_ID } from "../shared/reach.js";
import { actualFeeAmountFromGas, type ConfirmedTransactionAccounting } from "../shared/transactionAccounting.js";

const feeTokenAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

type TransactionLike = {
  hash?: Hex;
  from?: Address;
  to?: Address | null;
  chainId?: number | bigint;
  feeToken?: Address;
};

type ReceiptLike = {
  transactionHash?: Hex;
  status?: "success" | "reverted" | string;
  gasUsed?: bigint | string;
  effectiveGasPrice?: bigint | string;
  feeToken?: Address;
  from?: Address;
};

export type AccountingReader = {
  getChainId: () => Promise<number>;
  getTransaction: (args: { hash: Hex }) => Promise<TransactionLike | null>;
  getTransactionReceipt: (args: { hash: Hex }) => Promise<ReceiptLike>;
  readContract: (args: { address: Address; abi: typeof feeTokenAbi; functionName: "decimals" | "symbol" }) => Promise<unknown>;
};

export type AccountingRecoveryOptions = {
  expectedSender?: Address;
  expectedChainId?: number;
  expectedTo?: Address | readonly Address[];
};

function asBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "bigint" && typeof value !== "number") return null;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function validHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function sameAddress(left: unknown, right: Address): boolean {
  return typeof left === "string" && isAddress(left) && left.toLowerCase() === right.toLowerCase();
}

function matchesExpectedTarget(value: unknown, expected: Address | readonly Address[]): boolean {
  if (value === null || value === undefined) return false;
  const targets = Array.isArray(expected) ? expected : [expected];
  return targets.some((target) => sameAddress(value, target));
}

/**
 * Recover historical fee accounting from authoritative Tempo transaction data.
 * A null result means the receipt cannot be proven safe to display as actual
 * accounting; callers must preserve the payout lifecycle and show unavailable
 * fee details instead.
 */
export async function recoverConfirmedTransactionAccounting(
  reader: AccountingReader,
  txHash: Hex,
  options: AccountingRecoveryOptions = {},
): Promise<ConfirmedTransactionAccounting | null> {
  if (!validHash(txHash)) return null;

  try {
    const expectedChainId = options.expectedChainId ?? TEMPO_MODERATO_CHAIN_ID;
    const [chainId, transaction, receipt] = await Promise.all([
      reader.getChainId(),
      reader.getTransaction({ hash: txHash }),
      reader.getTransactionReceipt({ hash: txHash }),
    ]);

    if (chainId !== expectedChainId || !transaction || !receipt || receipt.status !== "success") return null;
    if (transaction.chainId !== undefined && Number(transaction.chainId) !== expectedChainId) return null;
    if (receipt.transactionHash && receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) return null;
    if (options.expectedSender && !sameAddress(transaction.from ?? receipt.from, options.expectedSender)) return null;
    if (options.expectedTo && !matchesExpectedTarget(transaction.to, options.expectedTo)) return null;

    const feeToken = receipt.feeToken ?? transaction.feeToken;
    if (!feeToken || !isAddress(feeToken)) return null;
    const gasUsed = asBigInt(receipt.gasUsed);
    const effectiveGasPrice = asBigInt(receipt.effectiveGasPrice);
    if (gasUsed === null || effectiveGasPrice === null) return null;

    const decimalsValue = await reader.readContract({ address: feeToken, abi: feeTokenAbi, functionName: "decimals" });
    const decimals = asBigInt(decimalsValue);
    if (decimals === null || decimals > 255n) return null;

    let symbol: string | undefined;
    try {
      const symbolValue = await reader.readContract({ address: feeToken, abi: feeTokenAbi, functionName: "symbol" });
      if (typeof symbolValue === "string" && symbolValue.length > 0 && symbolValue.length <= 32) symbol = symbolValue;
    } catch {
      // The token address and decimals are sufficient proof of the fee amount.
    }

    return {
      txHash,
      receiptStatus: "success",
      feeToken,
      feeTokenDecimals: Number(decimals),
      ...(symbol ? { feeTokenSymbol: symbol } : {}),
      actualFeeAmount: actualFeeAmountFromGas(gasUsed, effectiveGasPrice, Number(decimals)).toString(),
      gasUsed: gasUsed.toString(),
      effectiveGasPrice: effectiveGasPrice.toString(),
    };
  } catch {
    return null;
  }
}

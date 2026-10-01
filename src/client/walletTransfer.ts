import { decodeEventLog, encodeFunctionData, isAddress, parseAbi, type Address, type Hex } from "viem";
import { PATH_USD_ADDRESS, pathUsdAbi, TEMPO_MODERATO_CHAIN_ID } from "../shared/reach";
import { senderFundingRequest, type SenderFundingRequest } from "./senderFunding";
import { parsePathUsdAmount } from "./senderFlow";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const walletTransferEventAbi = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);

export type WalletTransferIntent = {
  operationId: string;
  sender: Address;
  recipient: Address;
  amount: string;
  createdAt: string;
  fromBlock: bigint;
  baselineSenderBalance: string;
  baselineRecipientBalance: string;
};

export type WalletTransferAuthority = {
  confirmed: boolean;
  senderBalance: string;
  recipientBalance: string;
  transferEvent: boolean;
  receiptStatus?: "success" | "reverted";
};

export function validateWalletTransferInput(input: { sender: string; recipient: string; amount: string; balance: string }): { recipient: Address; amount: bigint } {
  if (!isAddress(input.recipient)) throw new Error("Enter a valid Tempo wallet address.");
  if (input.recipient.toLowerCase() === input.sender.toLowerCase()) throw new Error("Choose a different wallet address.");
  if (input.recipient.toLowerCase() === ZERO_ADDRESS) throw new Error("The zero address cannot receive funds.");

  let amount: bigint;
  try {
    amount = parsePathUsdAmount(input.amount);
  } catch {
    throw new Error("Enter an amount greater than 0 pathUSD.");
  }
  if (amount > BigInt(input.balance)) throw new Error("Amount exceeds your available pathUSD balance.");
  return { recipient: input.recipient as Address, amount };
}

export function walletTransferCall(recipient: Address, amount: bigint): { to: Address; data: Hex; value: bigint } {
  return {
    to: PATH_USD_ADDRESS,
    data: encodeFunctionData({ abi: pathUsdAbi, functionName: "transfer", args: [recipient, amount] }),
    value: 0n,
  };
}

export function walletTransferRequest(recipient: Address, amount: bigint): SenderFundingRequest {
  return senderFundingRequest([walletTransferCall(recipient, amount)]);
}

export function extractWalletTransactionHash(value: unknown): string | undefined {
  if (typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value)) return value;
  if (value && typeof value === "object" && "hash" in value && typeof (value as { hash?: unknown }).hash === "string") {
    const hash = (value as { hash: string }).hash;
    return /^0x[0-9a-f]{64}$/i.test(hash) ? hash : undefined;
  }
  return undefined;
}

function matchingTransferLog(log: any, intent: WalletTransferIntent): boolean {
  try {
    if (typeof log.address === "string" && log.address.toLowerCase() !== PATH_USD_ADDRESS.toLowerCase()) return false;
    const decoded = decodeEventLog({ abi: walletTransferEventAbi, data: log.data, topics: log.topics }) as unknown as { eventName?: unknown; args?: unknown };
    if (decoded.eventName !== "Transfer") return false;
    const args = decoded.args as { from?: Address; to?: Address; value?: bigint };
    return args.from?.toLowerCase() === intent.sender.toLowerCase()
      && args.to?.toLowerCase() === intent.recipient.toLowerCase()
      && args.value === BigInt(intent.amount);
  } catch {
    return false;
  }
}

/**
 * Direct transfer authority is the token Transfer event, with exact balance
 * deltas as a second public-chain proof. No provider response is treated as
 * financial success on its own.
 */
export async function readWalletTransferAuthority(publicClient: any, intent: WalletTransferIntent, transactionHash?: string): Promise<WalletTransferAuthority> {
  let receiptStatus: "success" | "reverted" | undefined;
  let transferEvent = false;

  if (transactionHash) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash });
      receiptStatus = receipt.status === "success" ? "success" : "reverted";
      transferEvent = receipt.logs.some((log: any) => matchingTransferLog(log, intent));
    } catch {
      // The receipt may lag while the public token state is already observable.
    }
  }

  if (!transferEvent) {
    try {
      const logs = await publicClient.getLogs({
        address: PATH_USD_ADDRESS,
        event: walletTransferEventAbi[0],
        args: { from: intent.sender, to: intent.recipient },
        fromBlock: intent.fromBlock,
        toBlock: "latest",
      });
      transferEvent = logs.some((log: any) => matchingTransferLog(log, intent));
    } catch {
      // Balance evidence below remains a valid public authority.
    }
  }

  const [senderBalance, recipientBalance] = await Promise.all([
    publicClient.readContract({ address: PATH_USD_ADDRESS, abi: pathUsdAbi, functionName: "balanceOf", args: [intent.sender] }),
    publicClient.readContract({ address: PATH_USD_ADDRESS, abi: pathUsdAbi, functionName: "balanceOf", args: [intent.recipient] }),
  ]) as [bigint, bigint];
  const expectedSenderBalance = BigInt(intent.baselineSenderBalance) - BigInt(intent.amount);
  const expectedRecipientBalance = BigInt(intent.baselineRecipientBalance) + BigInt(intent.amount);
  const exactBalanceEvidence = senderBalance === expectedSenderBalance && recipientBalance === expectedRecipientBalance;

  return {
    confirmed: transferEvent || exactBalanceEvidence,
    senderBalance: senderBalance.toString(),
    recipientBalance: recipientBalance.toString(),
    transferEvent,
    ...(receiptStatus ? { receiptStatus } : {}),
  };
}

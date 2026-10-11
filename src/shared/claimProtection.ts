export type ClaimProtectionMode = "INSTANT" | "PROTECTED";
export type ClaimProtectionChannel = "EMAIL" | "SMS";

/**
 * Shared request shape for single-send and batch payment callers.
 * The recipient field is accepted only on protected creation requests and is
 * never returned by public payout APIs.
 */
export type ClaimProtection =
  | { mode: "INSTANT" }
  | {
      mode: "PROTECTED";
      channel: ClaimProtectionChannel;
      recipient: string;
    };

export type ProtectedClaimPublicMetadata = {
  mode: "PROTECTED";
  channel: ClaimProtectionChannel;
  maskedRecipient: string;
};

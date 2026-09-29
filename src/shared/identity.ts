import { Account as TempoAccount } from "viem/tempo";
import type { Address, Hex } from "viem";

/**
 * The public portion of an Accounts SDK WebAuthn credential record.
 *
 * The credential id is required later to ask the authenticator to sign, while
 * Tempo derives the root account address from the P-256 public key.
 */
export type WebAuthnCredentialRecord = {
  id: string;
  publicKey: Hex;
  rpId: string;
};

/**
 * Reconstruct the Tempo root account represented by an SDK credential record.
 *
 * This deliberately delegates to the maintained Tempo constructor instead of
 * introducing an application-owned identity mapping.
 */
export function deriveTempoAccountAddress(credential: WebAuthnCredentialRecord): Address {
  return TempoAccount.fromWebAuthnP256(
    { id: credential.id, publicKey: credential.publicKey },
    { rpId: credential.rpId },
  ).address;
}

import { resolvePayoutLifecycle, type AuthoritativePayout } from "../../src/client/payoutLifecycle";
import type { PayoutStatus } from "../../src/shared/reach";

export const canonicalPayout: AuthoritativePayout = {
  sender: "0x1111111111111111111111111111111111111111", amount: "100000",
  expiresAt: "1000", claimSigner: "0x2222222222222222222222222222222222222222",
  status: 1, claimant: "0x0000000000000000000000000000000000000000",
};
// Test adapters preserve the original boundary cases while exercising complete authority.
export function isReclaimEligible(status: PayoutStatus, expiresAt: bigint, chainTimestamp: bigint, sender: string, connectedAccount?: string) {
  return resolvePayoutLifecycle({ authoritativePayout: { ...canonicalPayout, status, expiresAt: expiresAt.toString(), sender }, chainTimestamp, connectedAccount }).isReclaimable;
}
export function publicStatusLabel(status: PayoutStatus, expiresAt: bigint, chainTimestamp: bigint) {
  return resolvePayoutLifecycle({ authoritativePayout: { ...canonicalPayout, status, expiresAt: expiresAt.toString() }, chainTimestamp }).statusLabel;
}

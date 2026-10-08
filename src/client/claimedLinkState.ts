export type ClaimedLinkView = "CLAIMED" | "ALREADY_CLAIMED";

export function claimedLinkView(claimant: string, connectedAddress?: string): ClaimedLinkView {
  return connectedAddress && claimant.toLowerCase() === connectedAddress.toLowerCase() ? "CLAIMED" : "ALREADY_CLAIMED";
}

# Reach Kill Gates — Phase 1 Update

Status date: 2026-09-21

## Gate 1 — dedicated vault instead of pooled custody

Status: PASS for the contract core and live testnet integration.

Evidence: `ReachPayoutVault` holds the exact pathUSD balance per payout ID. Atomic funding rejects insufficient allowance/balance without a `FUNDED` record. The corrected Moderato deployment funded 1,000,000 units and its vault balance matched the payout amount. No backend or sender key owns the entitlement.

## Gate 2 — exactly one successful claim

Status: PASS for the contract core and live testnet integration.

Evidence: local race test runs two claim attempts and gets one success/one revert; duplicate claim is impossible; a live claim changed storage to `CLAIMED` and transferred the exact amount to the signed recipient.

## Gate 3 — expiry/reclaim and claim mutually safe

Status: PASS for the contract core and live testnet integration.

Evidence: local tests cover before, at/after expiry, claim/reclaim exclusions, sender-only reclaim, and race behavior. Live second payout reached `RECLAIMED` after expiry and returned the exact amount to the sender. Claim is valid only for `timestamp < expiresAt`; reclaim is valid only for `timestamp >= expiresAt`.

## Gate 4 — recipient onboarding without a conventional wallet

Status: HOLD.

The vault accepts any destination address signed by the one-time claim signer, and the contract path is live-proven. Reach has not yet run a cold-link Tempo passkey/WebAuthn account ceremony in a browser.

Required evidence: new supported account from a cold claim link on mobile and desktop, no sender-collected recipient address, exact token received.

## Gate 5 — sponsored claim fees

Status: HOLD.

The public sponsor endpoint is reachable, but the actual sponsored passkey claim flow has not been exercised. No claim of sponsored UX is made.

Required evidence: recipient with no fee balance signs the exact claim, sponsor accepts it, claim settles, and sponsor rejection/outage has a human recovery state.

## Gate 6 — authoritative reconciliation

Status: HOLD.

Direct reads and receipts prove the vault state transitions, but no backend indexer, restart replay, unknown-receipt handling, or database reconciliation exists yet.

Required evidence: idempotent lifecycle event replay, receipt-unknown state, direct vault/database agreement, and no optimistic `CLAIMED` UI.

## Gate 7 — recipient-selected settlement

Status: KILL FOR V1.

Current official Tempo material describes onchain FX and non-USD stablecoin support for direct onchain liquidity as coming soon. Reach keeps one verified v1 TIP-20 token per deployment.

## Phase 0 gate

Status: PASS for the contract-core objective that blocked Phase 1: the unsafe authorization assumption was rejected, the vault compiled, local adversarial tests passed, and live Moderato create/fund/claim/reclaim integration was proven. The broader product remains BUILDING and is not UAT, RELEASE, or FINISHED.

## Phase 1 status

`INTEGRATION PROVEN — payout vault on Tempo testnet`

This status is deliberately narrower than product readiness. Gates 4–6 remain HOLD and the web application has not been built.

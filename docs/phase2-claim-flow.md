# Reach Phase 2 — Recipient Claim Flow

Status: UAT READY — RECIPIENT CLAIM FLOW

## Flow

`FUNDED` payout → fragment claim link → local signer derivation → onchain payout read → signer match → Tempo `webAuthn` account → local EIP-712 claim signature → one vault call → official Accounts relay → receipt → onchain payout reread → `CLAIMED`.

The fragment is a 32-byte random secp256k1 private key encoded as unpadded base64url. It is a bearer capability, not an identity credential. The browser strips it with `history.replaceState` before the payout read. Only a same-tab `sessionStorage` value can restore a refresh; there is no `localStorage`, cookie, server session, analytics, or telemetry copy of the capability.

## Server routes

- `GET /api/payout/:payoutId` — reads `getPayout` from the exact Moderato vault and returns public payout fields as strings.
- `GET /api/balance/:address` — reads public pathUSD balance for UAT evidence.
- `/auth/*` — maintained `Handler.webAuthn` with configured origin/RP ID.
- `/relay/*` — maintained `Handler.relay` with the Reach-specific one-call claim guard.

The local WebAuthn store is `Kv.memory()` because no durable deployment credential was available. A production deployment must use a durable linearizable store and an owned HTTPS origin.

## Relay guard

The server accepts only chain `42431`, one zero-value call to `0x98262c02746f3b91342249159deeebe87a54266c`, selector `claim(uint256,address,bytes)`, and a recipient equal to the account sender. It reads the payout, checks `FUNDED` and expiry, recovers the typed-data signature, and simulates the call before the official relay signs a fee-payer envelope. It rejects arbitrary batches, `createPayout`, `reclaim`, token transfers, arbitrary contract calls, native value, authorization lists, user fee payers, and wrong chains.

The only sponsor secret is `REACH_FEE_PAYER_PRIVATE_KEY`, server-only. It is not bundled or returned. No live sponsor proof has been run in this environment, so the zero-gas gate remains HOLD.

## Tests

`test/browser/claim-link.spec.ts` names the sentinel capability test and inspects request URLs, headers, bodies, address bar, DOM, console, and same-tab storage. `test/claimLink.test.ts` covers capability decoding and relay boundary rejection. The Phase 1 contract suite remains unchanged and runs through the contract-only `pnpm test` script.

## UAT evidence still required

For a real Moderato proof, record the cold session, passkey-derived recipient address, initial pathUSD and fee balances, initialization transaction, sponsor/fee-payer evidence, claim transaction and receipt, ending pathUSD balance, vault status `CLAIMED`, redacted link, and concise screenshots. If the owner cannot approve the actual device passkey prompt, stop at UAT READY and do not report an integration pass.

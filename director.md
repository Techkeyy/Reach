# Reach Director State

Last updated: 2026-09-21
Current status: BUILDING
Current phase: PHASE 2 — real recipient claim vertical slice
Phase 2 status: UAT READY — RECIPIENT CLAIM FLOW
Submission status: NOT READY

This is a factual handoff. The Phase 2 implementation is locally verified, but no real human passkey approval or zero-gas Moderato recipient claim has been reported as successful. Overall status remains BUILDING.

## Phase 2 objective

The intended path is:

`FUNDED PAYOUT → COLD CLAIM LINK → NEW PASSKEY ACCOUNT → ZERO-GAS CLAIM → REAL TOKEN BALANCE → CONFIRMED CLAIMED STATE`

The code now has a real mobile-first route at `/c/<payoutId>#<claimCapability>`. It is a consumer claim route, not a disposable demo page. There is still no sender dashboard.

## Current implementation

- Frontend: Vite `8.3.0`, React `19.3.0`, React DOM `19.3.0`, Wagmi `3.7.7`, Viem `2.56.8`.
- Maintained Tempo account SDK: `accounts@0.18.4`; the package exposes the maintained `accounts/server` entrypoint used by this app.
- Server: Hono `4.13.8` with `@hono/node-server@2.1.1`; local process entry is `src/server-entry.ts`.
- Browser proof: `@playwright/test@1.63.0`, Chromium installed by Playwright.
- Supporting tools: TypeScript `7.0.2`, TSX `4.23.15`, Vite React plugin `6.1.1`, Concurrently `10.0.5`.
- Official sources reviewed before integration: [Tempo Accounts SDK](https://github.com/tempoxyz/accounts), [current WebAuthn example](https://github.com/tempoxyz/accounts/tree/main/examples/webauthn), [current fee-payer + WebAuthn example](https://github.com/tempoxyz/accounts/tree/main/examples/fee-payer-and-webauthn), and the published [accounts package](https://www.npmjs.com/package/accounts).

The current official example shape is used directly: `webAuthn({ testnet: true, authUrl: '/auth', feePayer: '/relay' })` in the browser and `Handler.relay({ feePayer: { account } })` plus `Handler.webAuthn(...)` on the server. The archived `tempoxyz/tempo-ts` integration is not used.

## Claim capability boundary

Link format:

`http://127.0.0.1:5173/c/<decimalPayoutId>#<43-character-base64url-encoding-of-32-random-bytes>`

The fragment is the bearer capability. It is never put in query parameters, the pathname, cookies, server request bodies before it is necessary, analytics, telemetry, error payloads, or logs. The loader:

1. validates the decimal payout ID;
2. reads and validates the fragment locally as exactly 32 bytes;
3. derives the secp256k1 `claimSigner` in the browser;
4. immediately calls `history.replaceState` to remove the fragment from the address bar;
5. reads the real onchain payout through `GET /api/payout/<payoutId>`;
6. refuses to render a claim CTA unless the locally derived signer equals the stored onchain signer.

The same-tab fallback is `sessionStorage['reach.claim.<payoutId>']`. `localStorage` is not used. The pending transaction record stores only recipient and optional transaction hash. Capability and pending storage are cleared after authoritative `CLAIMED` or `RECLAIMED`, and the terminal UI offers an explicit clear action. A browser restart requires the original link.

The two signatures remain separate:

- bearer claim key: client-only EIP-712 authorization for `Claim(payoutId, recipient, action, version)`;
- Tempo passkey account: recipient account authorization for submitting the vault transaction.

The claim key is not the Tempo account, and the passkey is not the bearer capability.

## Recipient account and passkey architecture

The only browser connector is the maintained Tempo `webAuthn` connector from `wagmi/tempo`. Injected wallets and MetaMask are disabled with `multiInjectedProviderDiscovery: false`. There is no pre-imported conventional wallet and no hidden manually generated recipient wallet.

The first claim uses `capabilities: { method: 'register', name: 'Reach recipient' }`; a returning user uses the existing supported passkey session. The official handler owns the WebAuthn ceremony and account initialization path. Browser copy names device-native choices: fingerprint, Face ID, Windows Hello, PIN, or another supported passkey.

Configured development RP/origin:

- origin: `http://127.0.0.1:5173`
- RP ID: `127.0.0.1`
- WebAuthn endpoint: same-origin `/auth`, proxied to the local Hono server

This is stable for local development only. No owned production HTTPS hostname or deploy credential was available, so a production passkey proof has not been fabricated. Production uses explicit `REACH_ORIGIN` and `REACH_RP_ID`; they are not hardcoded to an unowned domain.

## Sponsored claim boundary

`/relay` is a narrow Reach sponsor boundary around the maintained `Handler.relay` API. The server-only key is `REACH_FEE_PAYER_PRIVATE_KEY`; it is not a `NEXT_PUBLIC_*` variable, browser storage value, response field, Git file, or client bundle value. It is absent from `.env.example` and must be supplied only to the server process.

Before the official relay can sponsor a fill, Reach validates and simulates:

- chain ID exactly `42431` (Tempo Moderato);
- exactly one call;
- exact current vault target `0x98262c02746f3b91342249159deeebe87a54266c`;
- exact `claim(uint256,address,bytes)` selector;
- zero native value and no authorization list or arbitrary top-level data;
- recipient encoded in the claim equals the Tempo transaction sender;
- payout exists, is `FUNDED`, and is not expired at the latest block timestamp;
- EIP-712 claim signature recovers to the payout’s stored `claimSigner`;
- `simulateContract` succeeds before fee sponsorship.

The guard rejects `createPayout`, `reclaim`, arbitrary token transfers, arbitrary contract calls, arbitrary batches, wrong chain, user-selected fee payer, and native value. The vault protects payout principal; concurrent valid fills can still waste sponsor fees, which is an open abuse/retry concern rather than a reason to widen the sponsor.

Local server health currently reports `sponsorConfigured: false` because no fee-payer secret has been supplied to this build environment. The relay path is implemented and typed, but Gate 5 has not been called PASS without a real sponsored transaction.

## Authoritative status flow

The frontend never sets `CLAIMED` from a click, a passkey prompt, a relay response, or an optimistic transaction hash. After `useSendTransactionSync`, it rereads `/api/payout/<payoutId>` and only shows `CLAIMED` when the vault returns `status = 2`. `RECLAIMED`, `EXPIRED`, `ALREADY CLAIMED`, retryable RPC failure, and unknown state are distinct UI states. A pending recipient/transaction hash prevents blind duplicate action after refresh; the page checks the payout again instead.

The server smoke read was run against the Phase 1 evidence payout `1789978000441`: the live endpoint returned the real Moderato record with amount `1,000,000`, status `2`, and the recorded claimant. A nonexistent payout returned status `0` without leaking any capability.

## Automated proof

Commands and observed results:

```text
pnpm typecheck       -> success
pnpm build:web       -> success; 2,152 modules transformed
pnpm test            -> 25 passing (25 nodejs) — Phase 1 vault suite
pnpm test:phase2     -> 4 passing (4 nodejs)
pnpm test:browser    -> 4 passed — Playwright Chromium
```

The named browser sentinel test is `test/browser/claim-link.spec.ts`. It observes every generated request and asserts the sentinel capability is absent from request URLs, headers, bodies, the post-redaction URL, DOM, and console text. It also proves missing-fragment, mismatched-signer, and authoritative claimed-state behavior, including same-tab capability clearing.

Phase 2 node tests cover exact 32-byte capability decoding, malformed/padded/overlong values, one-call zero-value Moderato vault claim parsing, wrong chain, wrong target, native value, multi-call, and recipient/sender mismatch rejection.

## Live and manual evidence state

Phase 1 live contract evidence remains valid and is recorded in `docs/moderato-live-evidence.md`; this phase does not reopen the vault design. No Phase 2 live sponsored claim evidence exists yet. Missing items are: cold-session passkey account creation, initialization transaction, fee-payer evidence, recipient starting/ending pathUSD balances, sponsored claim receipt, live `CLAIMED` reread, and screenshots.

Manual UAT is therefore ready but not executed. The operator action is intentionally one step at a time: configure the sender-side env and run `pnpm create:claim-link`, open the printed local link in the owner’s browser, click `Claim`, approve the device passkey prompt, then record the new Tempo account address and result. If this build cannot receive a real Windows Hello/biometric/device prompt, the run stops at this UAT READY state; it must not be reported as a passkey proof.

## Gate status

- Gates 1–3: PASS for the Phase 1 vault core and live Moderato integration.
- Gate 4 — walletless recipient/passkey: HOLD. The maintained connector and route are implemented and browser-tested, but no real human cold-session passkey ceremony has been completed.
- Gate 5 — sponsored zero-gas claim: HOLD. The narrow relay guard is implemented and unit-tested, but no live sponsor key/claim proof is available in this environment.
- Gate 6 — authoritative state/reconciliation: HOLD pending the live sponsored claim; local UI/server tests enforce reread-before-`CLAIMED`.
- Gate 7: KILL FOR V1; recipient-selected settlement remains removed.
- Gate 8: DEFERRED; MPP is not in the build.

If Gate 4 or Gate 5 fails during UAT, stop. Do not silently require MetaMask, a conventional wallet, or a faucet.

## Open concerns and recommended Phase 3

Open concerns are the stable production HTTPS/RP origin, durable WebAuthn/session storage instead of `Kv.memory()`, real sponsor-key custody/rotation/fee balance monitoring, event replay and database reconciliation, retry/unknown-receipt handling, and the documented possibility of sponsor-fee waste from concurrent valid fills.

Recommended Phase 3 only after Gates 4–6 have evidence: establish an owned HTTPS origin, replace memory KV with a durable linearizable store, add event-backed reconciliation and receipt-unknown recovery, then build the sender payout creation flow. Do not add batch UI, API monetization, MPP, mainnet, or marketing work before the money path is proven.

# Reach Director State

Last updated: 2026-09-29
Current status: BUILDING
Current phase: TESTNET ACCOUNT FUNDING
Phase 2 status: UAT PASS
Phase 3 status: UAT READY — restart recovery
Deployment status: DEPLOYED / UAT READY
Submission status: NOT READY

## Current cold-start funding handoff (2026-09-27)

Account funding: local validation complete; production deployment and owner UAT are separate gates. Phase 3 remains UAT READY. Phase 4 remains reported INTEGRATION PROVEN / UAT READY CANDIDATE, not UAT PASS; the current reconstruction does not elevate that report.

See [testnet account funding evidence](docs/testnet-account-funding.md) for the authoritative one-call faucet result, repository reconstruction, public-only persistence, address-binding limitations, and release blockers. The live primitive added exactly 1,000,000 pathUSD to a fresh throwaway public address; it did not create a payout or prove normal financial UAT.

Five pre-existing emptied proof/test files and the untracked two-call faucet probe are preserved. Historical sections below contain older architecture/status claims and must not override the current reconstruction or be treated as fresh proof.

## P0 identity continuity — SDK-native recovery

Recorded: 2026-09-29

Branch: `ui/reach-onboarding`
Implementation status: local fix complete; not merged and not deployed.
Financial status: no payout, funding, claim, reclaim, faucet, or recipient transaction was performed for this work.

### Identity authority and derivation

- Reach continues to use the maintained `accounts@0.18.4` WebAuthn adapter and its durable server credential records (`credential:<credentialId>`); no Reach users table, wallet mapping, or custom identity protocol was added.
- `Account.fromWebAuthnP256({ id, publicKey }, { rpId })` delegates address derivation to the P-256 public key. The root Tempo address is determined by `publicKey`; `credentialId` is retained for later authenticator signing but changing only the credential ID does not change the derived address. A different public key derives a different address.
- The Accounts browser snapshot is a durable IndexedDB cache/provider state (`tempo`); it is not the identity authority. The server credential record and a fresh WebAuthn login are the recovery boundary. The SDK's HTTP session is separate and expires after 24 hours.
- Localhost keeps RP ID `localhost`; production keeps RP ID `reach-seven-lemon.vercel.app`. They are separate WebAuthn credential namespaces and are not bridged.

### Partial registration handling

- `PASSKEY_CREATED_SETUP_INCOMPLETE` stores the exact serialized registration completion payload in a separate local IndexedDB namespace (`reach.identity`) when the passkey ceremony succeeds but completion does not return successfully. `Finish setup` retries that payload and never calls `navigator.credentials.create()` again.
- The recovery path distinguishes `PASSKEY_CREATED_SERVER_NOT_COMMITTED` (same completion payload can still be accepted while its challenge remains valid) from `SERVER_COMMITTED_CLIENT_NOT_PERSISTED` (the SDK credential record is already present; the client reconciles the exact public-key record and then performs a normal login to prove authenticator possession).
- The Accounts handler's actual ordering is: verify the registration response; atomically create `credential:<credentialId>`; run `onRegister`; delete the challenge; issue the session. If persistence or the hook fails, the handler deletes the credential and challenge. A successful response can therefore lose its transport after the credential commit; the new read-only reconciliation route handles that case without issuing a session or mutating KV.
- If the browser closes after Case A while the server never stored the credential and the serialized response/challenge are gone, current WebAuthn/Accounts primitives cannot recover the public key from the passkey alone. Reach must not silently create another identity.
- Multiple-passkey linking to an existing Tempo account was not found in the maintained Accounts/AccountKeychain path and was not implemented: `MULTIPLE PASSKEY RECOVERY: PLANNED / UNPROVEN`.

### Claim → mechanism → proof ledger

| Claim | Mechanism | Authoritative boundary | Required proof | Current proof | Status |
| --- | --- | --- | --- | --- | --- |
| Reach remembers my account | Accounts SDK IndexedDB snapshot remembers the current provider state; the durable Accounts KV credential record remains the identity authority | Tempo `Account.fromWebAuthnP256` plus the Accounts server credential record | Reconnect after browser state loss and derive the same address | Local Chromium/WebAuthn integration deleted the SDK snapshot, preserved the authenticator, and reconstructed the same public account; production/hardware remain separate gates | PASS — localhost integration |
| Signing in restores the same account | Login verifies the durable credential, then the SDK reconstructs the account from its public key | WebAuthn verification and Tempo account derivation, not client storage | Registration → fresh client/process → login yields the original address and session | Real browser registration, cookie loss, fresh login, and same-address equality pass; separate app instances share the exact Accounts record | PASS — localhost integration |
| Clearing browser app data does not create a new account | IndexedDB is only a cache; login uses the server credential and the authenticator | Durable `credential:<credentialId>` record and `Account.fromWebAuthnP256` | Remove provider snapshot, sign in with the same passkey, compare addresses | Chromium test deletes `tempo.store` and `tempo.lastCredentialId`, then signs in with the preserved authenticator and derives the same address | PASS — localhost integration |
| Failed account setup cannot silently create duplicates | Pending completion retries the same payload; committed-record reconciliation requires an exact public-key match and then a normal login; unknown credentials remain rejected by the SDK handler | Accounts credential store plus WebAuthn possession proof | Transport failure, duplicate completion, unknown credential, and serverless request separation all preserve one identity | Five real-browser scenarios pass; exact-record tests pass across separate app instances; one `navigator.credentials.create()` ceremony is enforced in retry cases | PASS — localhost integration |

### Final integration gate — localhost browser proof

Recorded: 2026-09-29

The required integration gate now passes against the running local app and API using Playwright Chromium's CDP virtual authenticator (`ctap2`, resident key, user verification, automatic presence simulation). This is a real browser WebAuthn ceremony, not a fixture-only account response. The test origin and RP ID are both `localhost`; production remains separately configured as `reach-seven-lemon.vercel.app` and was not changed.

- Registration created a public Tempo account, then the test deleted the Accounts SDK IndexedDB snapshot keys (`tempo.store`, `tempo.lastCredentialId`) and cleared the session cookie while preserving the virtual authenticator. A normal sign-in reconstructed the same public account address.
- The final full-suite run derived public account `0xfD152Fea9Dc363A78eB65cCda279954600D92252`; the post-loss login response derived the same address. This is public test evidence only; no private key, credential private material, bearer capability, or financial transaction was involved.
- Lost response after server commit: the upstream registration committed with HTTP 200, the browser saw the transport failure, the pending state survived reload, exact completion retry returned HTTP 400 for the consumed challenge, `/auth/register/reconcile` returned HTTP 200 `already_committed`, and normal login returned HTTP 200 for the same account. The browser create counter remained exactly 1 and the pending record was removed after recovery.
- Server-not-committed response: the first completion returned HTTP 503, Finish setup retried the exact serialized completion once, normal login succeeded, the account was created once, and the pending record was removed.
- Unknown credential: a passkey created while registration was deliberately not committed was rejected by login with HTTP 400. No registration fallback occurred and the browser create counter remained exactly 1.
- Expired pending state: a record older than the five-minute TTL was removed on read and did not trigger registration or a retry loop. Fresh records carry explicit `createdAt` and `expiresAt`; the timer is best-effort while every read enforces the TTL.
- Storage remains origin-local SDK IndexedDB (`tempo` database, `store` object store, key `reach.identity.pendingRegistration`) and contains only the serialized registration completion response needed for the short retry window. It is not a Reach identity database and is never the identity authority. Successful recovery and Start over clear it.
- Server separation: reconciliation was verified across two separately constructed app instances sharing the Accounts KV authority. No custom Reach identity table or account mapping was introduced.

Integration commands and results:

- `node node_modules/typescript/bin/tsc --noEmit` — PASS
- `node node_modules/tsx/dist/cli.mjs --test test/authFlow.test.ts test/claimLink.test.ts test/payoutDiscovery.test.ts test/serverApp.test.ts test/claimRecovery.test.ts test/testnetFunding.test.ts` — 49 passed
- `node node_modules/@playwright/test/cli.js test test/browser/identity-continuity.spec.ts --workers=1` — 5 passed
- full local browser suite — 49 passed, 5 skipped (the five fixture-only funding tests are intentionally skipped when `TARGET_URL` is set)
- Vite production build and API bundle — PASS

No financial, faucet, deployment, or production authentication mutation was performed for this gate. Hardware authenticator behavior and production-origin recovery remain separate release/UAT gates; the mandated local browser-style integration is proven.

## Deployment — GitHub + Vercel Single-Origin Production

Recorded: 2026-09-25

- Repository: `https://github.com/Techkeyy/Reach` (private repository under authenticated GitHub account `Techkeyy`).
- Branch: `main` (clean commit history preserved, no secrets tracked).
- Deployed Commit SHA: `84ec8de`
- Stable Production Hostname: `reach-seven-lemon.vercel.app`
- Production Origin: `https://reach-seven-lemon.vercel.app`
- WebAuthn RP ID: `reach-seven-lemon.vercel.app`
- WebAuthn RP Name: `reach-seven-lemon.vercel.app`
- WebAuthn Algorithm: `ES256` (`-7`)

### Architecture & Routing

Single stable HTTPS origin:
- Frontend root: `https://reach-seven-lemon.vercel.app/`
- SPA direct claim link navigation: `https://reach-seven-lemon.vercel.app/c/<payoutId>` (configured in `vercel.json` rewrites, returns 200 index.html)
- Same-origin API endpoints:
  - `GET /health` -> `{"ok":true,"chainId":42431,"sponsorConfigured":true}`
  - `GET /api/payout/:id` -> Authoritative onchain payout data
  - `GET /api/payouts/:sender` -> Authoritative discovered sender payouts
  - `GET /api/balance/:address` -> Authoritative pathUSD balance
  - `POST /auth/*` -> Passkey WebAuthn options negotiation & registration
  - `POST /relay/*` -> Narrow recipient claim sponsorship only

### WebAuthn Serverless State

The installed SDK `accounts@0.18.4` uses `Handler.webAuthn` with a key-value store for:
1. `challenge:<hex>` (short-lived challenge negotiation)
2. `credential:<credentialId>` (registered credential public key & user ID)
3. `session:<token>` (user session tokens)

Durable REST KV Adapter (`src/server/kvAdapter.ts`) connects to `KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL` with graceful fallback to `Kv.memory()`.

### Deployed Smoke Test Results (Read-Only)

All 10 automated smoke checks passed on `https://reach-seven-lemon.vercel.app`:
1. `GET /` -> HTTP 200 (HTML) [PASS]
2. `GET /c/1790060937954` -> HTTP 200 (HTML, no 404) [PASS]
3. `GET /health` -> HTTP 200 (`ok: true`, `chainId: 42431`, `sponsorConfigured: true`) [PASS]
4. `GET /api/payout/1790060937954` -> HTTP 200 (`status: 2 (CLAIMED)`, `amount: 1000000`, `sender: 0x3DF6...`) [PASS]
5. `GET /api/payouts/0xAF75774194AbeEC3A0D86693d8A7bC1139311061` -> HTTP 200 (2 payouts found) [PASS]
6. `GET /api/balance/0xAF75774194AbeEC3A0D86693d8A7bC1139311061` -> HTTP 200 (`847369` base units) [PASS]
7. `POST /auth/register/options` -> HTTP 200 (`rp.id: reach-seven-lemon.vercel.app`, `alg: -7`) [PASS]
8. `POST /auth/login/options` -> HTTP 200 (`rpId: reach-seven-lemon.vercel.app`) [PASS]
9. `POST /auth/register/options` with untrusted origin -> HTTP 403 Forbidden [PASS]
10. `POST /relay` with arbitrary transaction -> Rejected (no arbitrary transaction execution) [PASS]

No new payout, funding transaction, claim transaction, or human passkey ceremony was performed. Phase 3 financial UAT remains gated.

## Phase 3 restart-recovery fix — public payout discovery

Recorded: 2026-09-24

The lost bearer capability remains an accepted limitation. It stays ephemeral in tab-scoped session storage and is never moved into localStorage, durable IndexedDB, cookies, URLs, a server database, public metadata, or logs. Reach cannot recreate a lost claim link.

The sender dashboard recovery blocker is fixed at the public-lifecycle layer. On sender connection, the server queries the maintained Tempo testnet tidx indexer for the connected sender’s indexed PayoutCreated events, decodes the raw topics/data to preserve exact 256-bit payout IDs and amounts, and rereads every discovered payout from the deployed ReachPayoutVault before returning it to the browser. The browser merges those authoritative records with any session-local notes/evidence; the local cache is not treated as lifecycle truth.

The new public endpoint is GET /api/payouts/<sender>. It returns only payout ID, sender, amount, expiry, claim signer, claimant, status, creation metadata, and recoverable funding transaction evidence. A funded payout is rendered separately from bearer availability: Funded can coexist with Claim link unavailable on this device/session, with explicit copy that Reach cannot recreate a lost link.

The sender can therefore reconnect after tab close, browser close, PC restart, or cleared session storage, rediscover old payouts without manually entering IDs, reread status/expiry/claimant, and use the existing sender-only reclaim path after expiry. This exact lost-capability 0.05 pathUSD payout remains reserved for the real reclaim UAT and was not touched by this fix.

### Claim → mechanism → proof ledger update

| Claim | Mechanism | Boundary | Required proof |
| --- | --- | --- | --- |
| Sender can return later and manage funded payouts | Authoritative sender payout discovery from Tempo indexed PayoutCreated events, followed by deployed-vault rereads | Public discovery = application/indexing layer; lifecycle truth = hard authoritative contract state | Full browser/PC restart, reconnect sender, and old funded payout reappears without manual payout ID entry |
| Lost claim credential does not lose principal | Bearer remains ephemeral; principal stays in the vault until recipient claim or sender-only reclaim after expiry | Hard enforced by the vault state machine | This exact lost-capability payout remains FUNDED through expiry and is reclaimed by the original sender through normal UI |

## Phase 3 UAT blocker — sender balance presentation

Recorded: 2026-09-23

The owner’s connected Tempo passkey account is `0xAF75774194AbeEC3A0D86693d8A7bC1139311061`. The authoritative Moderato read at block `36575337` returned `1,000,000` base units for pathUSD (`1.000000` pathUSD) from token `0x20c0000000000000000000000000000000000000`. No payout, approval, account creation, or transaction was performed for this investigation.

The sender balance boundary was proven: the browser request is `GET /api/balance/<address>` through the Vite proxy to the local Hono relay. With the relay stopped, the proxy returned HTTP `502` and the previous client catch path reset the value to `null`, while the rendered `null` state remained `Checking…`. The existing relay was restarted; `/health` is `HTTP 200` with `ok=true`, `chainId=42431`, and `sponsorConfigured=true`, and the browser-origin balance request now returns `HTTP 200` with the exact string balance `1000000`.

The sender UI now has an explicit `LOADING → READY` or `ERROR` state machine. `ERROR` renders `We couldn't read your Tempo balance.` with `Retry`; no fallback balance is used. Review and Sign & fund are disabled unless the authoritative balance is `READY`, the handler repeats the guard, and requested base units must be less than or equal to the exact onchain balance. Malformed responses and HTTP failures are safe errors, with development-only `BALANCE_READ` diagnostics containing only stage, HTTP status, and a safe error label.

The earlier balance-presentation blocker is resolved. Phase 3 is now in human sender UAT: the owner completed one real sender funding flow, and the authoritative funding evidence is recorded below. The recipient claim proof for that payout is invalidated because the bearer link was exposed in a screenshot. The app and relay remain running for the next gated step.

This is a factual handoff. Phase 2 has passed a real passkey-backed recipient claim for payout `1790060937954`; the authoritative onchain claim, recipient-balance, vault-accounting, fee-sponsorship, and terminal-refresh evidence remains recorded below. Phase 3 now adds the normal browser sender lifecycle on the existing vault. The owner-created payout below is valid sender-funding evidence; no operator-created replacement payout or claim was performed in this implementation turn.

## Phase 3 pre-phase financial cleanup

The three abandoned, expired, FUNDED Phase 2 UAT payouts were reread from Tempo Moderato before cleanup at block `36528670` (timestamp `1790150125`). All three had sender `0x3DF635253f3E0835a4723b93801f5d22461914A5`, amount `1,000,000` micro-pathUSD, zero claimant, status `FUNDED`, and an expiry earlier than the authoritative block timestamp. Reclaim was authorized only for this testnet cleanup and used the existing sender-only contract rule.

- `1790055969075` → reclaim transaction `0xaaa0e47e2ef0540857682f68aed33b624040d6a4a16e6eabe76db49370275d95`; receipt succeeded; final status `RECLAIMED` (`3`); final claimant zero; vault/`totalFundedAmount` after reclaim `2,000,000`.
- `1790058214461` → reclaim transaction `0x522a7c2261a71a138d8b40382a8cefe73cf522cd64d869a004c0fba9dfc92cef`; receipt succeeded; final status `RECLAIMED` (`3`); final claimant zero; vault/`totalFundedAmount` after reclaim `1,000,000`.
- `1790059395103` → reclaim transaction `0x9a0b570b129196dc339d7ac05a707c6852c962132bf5f51875afcfecdd5f662a`; receipt succeeded; final status `RECLAIMED` (`3`); final claimant zero; vault/`totalFundedAmount` after reclaim `0`.

The successfully claimed artifact `1790060937954` was reread as `CLAIMED` (`2`) with claimant `0xAF75774194AbeEC3A0D86693d8A7bC1139311061` and was not touched. Final cleanup accounting is exact: Reach vault pathUSD balance `0` and `totalFundedAmount = 0`. No private key or bearer capability is recorded here.

## Phase 3 sender product contract

The normal sender journey is now:

`ROOT → TEMPO PASSKEY ACCOUNT → REAL pathUSD BALANCE → EXACT AMOUNT + EXPIRY → LOCAL CAPABILITY → REVIEW → PREFLIGHTING → READY_TO_SIGN → SIGNING → SUBMITTED → CONFIRMING → FUNDED / FAILED_RETRYABLE / RECOVERY_REQUIRED → CLAIM LINK → PUBLIC DASHBOARD → EXPIRED RECLAIM`

The sender signs directly from their own Tempo WebAuthn account. The browser sends an atomic Tempo call batch containing `pathUSD.approve(ReachPayoutVault, amount)` followed by `ReachPayoutVault.createPayout(payoutId, amount, claimSigner, expiresAt)`. The contract remains the Phase 1 vault; it was not redeployed or redesigned. The sender reclaim UI sends only `ReachPayoutVault.reclaim(payoutId)` after the authoritative state is `FUNDED`, expiry has passed, and the connected sender matches the payout sender.

## Phase 2 objective

The intended recipient path is:

`FUNDED PAYOUT → COLD CLAIM LINK → NEW PASSKEY ACCOUNT → ZERO-GAS CLAIM → REAL TOKEN BALANCE → CONFIRMED CLAIMED STATE`

The code has a real mobile-first route at `/c/<payoutId>#<claimCapability>` and a separate root sender dashboard. The recipient route remains a consumer claim route, not a disposable demo page.

## Current implementation

- Frontend: Vite `8.3.0`, React `19.3.0`, React DOM `19.3.0`, Wagmi `3.7.7`, Viem `2.56.8`.
- Maintained Tempo account SDK: `accounts@0.18.4`; the package exposes the maintained `accounts/server` entrypoint used by this app.
- Server: Hono `4.13.8` with `@hono/node-server@2.1.1`; local process entry is `src/server-entry.ts`.
- Browser proof: `@playwright/test@1.63.0`, Chromium installed by Playwright.
- Supporting tools: TypeScript `7.0.2`, TSX `4.23.15`, Vite React plugin `6.1.1`, Concurrently `10.0.5`.
- Official sources reviewed before integration: [Tempo Accounts SDK](https://github.com/tempoxyz/accounts), [current WebAuthn example](https://github.com/tempoxyz/accounts/tree/main/examples/webauthn), [current fee-payer + WebAuthn example](https://github.com/tempoxyz/accounts/tree/main/examples/fee-payer-and-webauthn), and the published [accounts package](https://www.npmjs.com/package/accounts).

The current official example shape is used directly: `webAuthn({ testnet: true, authUrl: '/auth', feePayer: '/relay' })` in the browser and `Handler.relay({ feePayer: { account } })` plus `Handler.webAuthn(...)` on the server. The archived `tempoxyz/tempo-ts` integration is not used.

## Sender account, principal, and fee policy

`src/client/SenderDashboard.tsx` uses the maintained Wagmi Tempo `webAuthn` connector with `capabilities: { method: 'register', name: 'Reach sender' }`. It displays the connected public address and reads the actual pathUSD balance from `GET /api/balance/<address>`. No fake balance or server-owned sender account is used.

The sender transaction request explicitly sets `feePayer: false`. This opts the transaction out of the globally configured claim fee-payer URL while preserving the recipient claim connector configuration. The sender’s own Tempo account is therefore the transaction principal and uses the normal account fee path. Reclaim uses the same direct sender path. The server has no sender transaction endpoint and never signs `createPayout`, `approve`, or `reclaim` for the normal product flow. `TEMPO_DEPLOYER_PRIVATE_KEY` remains test/deployment infrastructure only.

The `/relay` service remains recipient-claim-only. `validateClaimForSponsorship` still accepts only one zero-value claim call to the configured vault and rejects `createPayout`, `reclaim`, arbitrary token transfers, arbitrary calls, arbitrary batches, wrong chains, native value, and user-selected fee payers. Sender sponsorship was not added.

## Sender dashboard and lifecycle source of truth

The root route is `src/client/SenderDashboard.tsx`. It is intentionally small:

- account creation/connection through the existing Tempo passkey connector;
- exact decimal amount entry with a six-decimal pathUSD boundary;
- optional local-only note and a fixed one-hour, 24-hour, or three-day expiry choice;
- review screen before signing;
- truthful `REVIEW`, `PREFLIGHTING`, `READY_TO_SIGN`, `SIGNING`, `SUBMITTED`, `CONFIRMING`, `FUNDED`, `FAILED_RETRYABLE`, and `RECOVERY_REQUIRED` states;
- funded state shows `Claim link ready` with the bearer fragment masked by default; `Copy claim link` passes the exact URL in memory, while `Reveal link` and `Hide link` are explicit controls;
- claim link release only after `/api/payout/<id>` returns the expected `FUNDED` record with the sender and derived `claimSigner` matching;
- public lifecycle dashboard discovers sender-owned payout IDs from `/api/payouts/<sender>`, rereads each payout from `/api/payout/<id>`, and does not require a bearer capability;
- sender-only `Reclaim` action for `FUNDED + expired` records.

The session index in `src/client/senderStorage.ts` stores only public data: payout ID, amount, expiry, claim signer, optional local note, transaction evidence, and created time. It never stores the bearer capability. On refresh, the dashboard can still show public lifecycle state from the index and authoritative API reread, even if the sender no longer has the link. A lost claim link is not regenerated; the sender can reclaim after expiry.

## Phase 3 fee-aware funding acceptance ledger

The sender remains on the direct fee path. No sender sponsorship was added and the claim-only relay boundary was not widened.

| Claim | Mechanism | Boundary | Required proof |
| --- | --- | --- | --- |
| Sender cannot knowingly submit an unaffordable payout through normal Reach UI | Exact Tempo `eth_fillTransaction` preflight of the real `approve + createPayout` batch before signing, with the real sender, chain `42431`, WebAuthn key type, and `feePayer: false` | SOFT ENFORCED — client/product transaction-construction boundary; not a protocol-level guarantee | Full-balance adversarial preflight fails with decoded `TokenTransferFailed()` before signing/submission; affordable `100,000` micro-pathUSD fill succeeds. No gas-math estimate is invented. |
| Reach only calls a payout `FUNDED` after principal actually settles in the vault | Successful transaction receipt plus authoritative vault reread matching payout ID, sender, exact amount, claimSigner, expiry, and status `FUNDED` | HARD source of truth = deployed contract state; UI enforcement = SOFT presentation layer | Real exact-match `FUNDED` resolution, with receipt-success mismatch entering `RECOVERY_REQUIRED`; A–J regression proof covers both. |
| Failed sender transaction is represented truthfully | Receipt-status branch plus authoritative payout read; reverted receipt becomes `FAILED_RETRYABLE`, unknown/mismatched state becomes `RECOVERY_REQUIRED` | SOFT ENFORCED application state | Known reverted transaction reconstructs `FAILED`, not `CONFIRMING`/`FUNDED`, with no claim link; evidence hash is retained and capability cleared. |

Known live sender artifact cleanup: payout `66734098054632377628940790133593306730712900761504354019136738427919374359704` has authoritative vault state `NONE`; its evidence transaction is `0x586af4b7fd831bac54590a213a7afd1aaabf8b06266edda472110d701a49c6ca` with reverted receipt. It is not reclaimable and no new claim capability is generated. On refresh, the sender dashboard reconciles this public record as `FAILED` and preserves the evidence hash while clearing the stored capability. The sender’s current authoritative balance is `998,814` micro-pathUSD (`0.998814` pathUSD), read through `/api/balance` at Moderato block `36674587`; it is not restored, faked, or used to submit a new payout in this implementation turn.

## Phase 3 live UAT — funded payout evidence and bearer exposure

Recorded: 2026-09-24

The owner completed the real sender passkey signing flow for exactly one `0.10` pathUSD payout. The funding outcome is valid sender-flow evidence, but the full claim URL was displayed in a screenshot, so the payout's bearer capability is compromised and is disallowed for recipient proof.

- Payout ID: `55596398158796912738519836714353507070181302874783804146314302142802913996845`.
- Principal: `100,000` micro-pathUSD (`0.10` pathUSD).
- Sender: `0xAF75774194AbeEC3A0D86693d8A7bC1139311061`.
- Funding transaction: `0x31c8ef7ac752f9663baa4852c98cdec45971aaf393dedb69116f784be93194c7`.
- Receipt: success (`status = 1`), block `36,677,520` (`0x22fa790`), transaction type `0x76`.
- Fee payer: the sender above; fee token: PathUSD `0x20c0000000000000000000000000000000000000`.
- Exact network fee: `817` micro-pathUSD (`0.000817` pathUSD), derived from the sender balance delta (`998,814` before the funding block to `897,997` currently, less the `100,000` principal). The receipt's `fee` field was null; no gas-math estimate is substituted.
- Authoritative payout reread: `FUNDED` (`status = 1`), claimant zero address, amount `100,000`, claim signer `0x9e2505836b9389bb94fa19a272fc11e9c4ca3e4e`, expiry `1790325760`.
- Vault accounting: PathUSD balance `100,000` micro-pathUSD and `totalFundedAmount = 100,000` micro-pathUSD.
- Sender balance after funding: `897,997` micro-pathUSD (`0.897997` pathUSD).

This payout is `LEVEL 4 REAL OUTCOME — PASS` for the sender-created funding component. The recipient claim proof from this payout is invalidated by bearer exposure. Do not use, copy, regenerate, or claim with that capability. If the payout remains funded after expiry, reclaim it through the sender-only expiry path.

An accessible local Chrome-session storage scan found no `reach.claim.<payoutId>` key value. The active owner browser tab was not available through the browser control session, so active-tab clearance cannot be independently asserted. Clearing local storage would not revoke an already exposed bearer; this payout remains disallowed for recipient UAT.

## Claim → mechanism → proof security ledger

| Claim | Mechanism | Proof boundary | Limitation |
| --- | --- | --- | --- |
| A claim link is a bearer credential | A 32-byte capability is encoded in the URL fragment; its derived signer is committed in the payout onchain | HARD ENFORCED by the vault's signature verification and stored `claimSigner` check | Confidentiality is SOFT and user-opsec dependent; anyone holding a disclosed link can claim while funded |
| A disclosed capability can be rotated or revoked before expiry | Not implemented | No protocol or product revocation/rotation boundary exists before expiry | Do not call the link recoverable, revocable, private, or recipient-bound; reclaim is only available to the sender after expiry |

The sender UX now keeps the funded link masked by default, supports explicit reveal/hide, copies only on explicit user action, warns that anyone with the link can claim, and does not place the capability in public payout metadata, analytics, logs, request URLs, or QR output.

## Claim capability boundary

Link format:

`http://localhost:5173/c/<decimalPayoutId>#<43-character-base64url-encoding-of-32-random-bytes>`

The fragment is the bearer capability. It is generated in `src/client/claimCapability.ts` with `crypto.getRandomValues`, and its local secp256k1 address is the exact `claimSigner` passed to `createPayout`. The capability is never sent to analytics, logs, query parameters, cookies, blockchain calldata, transaction memo, director.md, Git, or console output. The sender link is assembled only in memory after authoritative funding confirmation.

The fragment is retained only in the active browser/session path necessary for the claim flow (`sessionStorage['reach.claim.<payoutId>']`); `localStorage` is not used. Public sender dashboard storage contains no capability. Recipient boot removes the fragment from the address bar before the claim UI proceeds, reads the real onchain payout through `GET /api/payout/<payoutId>`, and refuses to render a claim CTA unless the locally derived signer equals the stored onchain signer.

The two signatures remain separate:

- bearer claim key: client-only EIP-712 authorization for `Claim(payoutId, recipient, action, version)`;
- Tempo passkey account: sender or recipient account authorization for submitting the vault transaction.

The claim key is not the Tempo account, and the passkey is not the bearer capability.

## Recipient account and passkey architecture

The only browser connector is the maintained Tempo `webAuthn` connector from `wagmi/tempo`. Injected wallets and MetaMask are disabled with `multiInjectedProviderDiscovery: false`. There is no pre-imported conventional wallet and no hidden manually generated recipient wallet.

The first claim uses `capabilities: { method: 'register', name: 'Reach recipient' }`; a returning user uses the existing supported passkey session. The official handler owns the WebAuthn ceremony and account initialization path. Browser copy names device-native choices: fingerprint, Face ID, Windows Hello, PIN, or another supported passkey.

Configured development RP/origin:

- origin: `http://localhost:5173`
- RP ID: `localhost`
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

Local server health reports `sponsorConfigured: true` from the locked local UAT environment. The relay path is implemented and typed, and the completed UAT receipt below proves a real sponsored transaction.

## Authoritative status flow

The sender frontend never sets `FUNDED` from a click, passkey prompt, or transaction hash. It first calls `eth_fillTransaction` with the exact sender, chain `42431`, WebAuthn key type, `feePayer: false`, and the real `approve + createPayout` batch. A failed fill blocks passkey signing and submission. After a hash it waits for the receipt, treats `status = 0` as `FAILED_RETRYABLE`, and only shows `FUNDED` plus the claim link after receipt success and an exact authoritative `/api/payout/<payoutId>` reread. A successful receipt with missing or mismatched vault state becomes `RECOVERY_REQUIRED`; failed public artifacts retain the evidence hash and clear the capability. Reclaim likewise waits for an authoritative `RECLAIMED` status.

The recipient frontend never sets `CLAIMED` from a click, a passkey prompt, a relay response, or an optimistic transaction hash. After `useSendTransactionSync`, it rereads `/api/payout/<payoutId>` and only shows `CLAIMED` when the vault returns `status = 2`. `RECLAIMED`, `EXPIRED`, `ALREADY CLAIMED`, retryable RPC failure, and unknown state are distinct UI states. A pending recipient/transaction hash prevents blind duplicate action after refresh; the page checks the payout again instead.

## Automated proof

Commands and observed results:

```text
pnpm typecheck       -> success
pnpm build:web       -> success; 2,160 modules transformed
pnpm test            -> 25 passing (25 nodejs) — Phase 1 vault suite
pnpm exec tsx --test test/senderFlow.test.ts test/senderClaimLink.test.ts -> 26 passing (26 nodejs), including required A–J fee/preflight/receipt/recovery regressions and funded-link masking/copy/reveal checks
pnpm test:phase2     -> 12 passing (12 nodejs), including sender restart-recovery discovery and lifecycle tests
pnpm test:browser    -> 8 passed — Playwright Chromium
```

The browser sentinel test remains `test/browser/claim-link.spec.ts`. It observes every generated request and asserts the sentinel capability is absent from request URLs, headers, bodies, the post-redaction URL, DOM, and console text. It also proves missing-fragment, mismatched-signer, and authoritative claimed-state behavior, including same-tab capability clearing. The browser harness now uses `http://localhost:5173`, matching the proven WebAuthn RP boundary; no human UAT interaction was performed.

Phase 3 node tests cover secure capability generation and signer derivation, positive payout IDs, exact decimal conversion, invalid amounts, exact approve/create calldata, exact fee-aware fill requests, full-balance preflight rejection before signing, affordable READY_TO_SIGN, receipt-reverted failure, receipt-success state mismatch recovery, exact FUNDED resolution, failed-artifact/capability cleanup, sender-only reclaim boundaries, claimed/reclaimed terminal states, a refreshable public sender index that contains no bearer capability, and the funded sender-link default-mask, exact-copy, explicit-reveal, hide, and no-public-leak checks.

## Live and manual evidence state

Phase 1 live contract evidence remains valid and is recorded in `docs/moderato-live-evidence.md`; this phase does not reopen the vault design. A real Phase 2 human passkey claim, sponsored receipt, exact recipient transfer, and terminal refresh/revisit behavior are proven below.

Manual UAT has been executed for payout `1790060937954`. The owner completed the device passkey ceremony, the app reached its `Claimed` state, the chain reread returned `status = 2`, the receipt proved the configured Reach fee payer sponsored the transaction, and a direct fragment-free revisit plus refresh remained terminal `CLAIMED` without a Claim button or mutation request.

Phase 3 manual sender UAT is in progress. The owner completed the sender passkey signing flow and produced the funded payout evidence recorded above. The owner also exposed the full bearer URL in a screenshot, so recipient proof from that payout is invalidated. A fresh recipient UAT payout is gated on the sender UX fix being exercised without exposing the link.

## Gate status

- Gates 1–3: PASS for the Phase 1 vault core and live Moderato integration.
- Gate 4 — walletless recipient/passkey: PASS for the Phase 2 UAT. The owner completed a real cold-session passkey ceremony and the resulting recipient account is the onchain transaction sender.
- Gate 5 — sponsored zero-gas claim: PASS for the Phase 2 UAT. The confirmed receipt names the configured Reach sponsor as `feePayer` while the recipient account is the transaction sender.
- Gate 6 — authoritative state/reconciliation: PASS for the Phase 2 UAT. The onchain reread is `CLAIMED`, duplicate claim is prevented, the fragment-free revisit and refresh remain terminal, and no bearer material is required for recovery.
- Gate 7: KILL FOR V1; recipient-selected settlement remains removed.
- Gate 8: DEFERRED; MPP is not in the build.
- Phase 3 sender flow: UAT READY — restart recovery implementation/tests complete; sender funding evidence PASS; human restart/reclaim UAT remains required; recipient claim proof for payout `55596398158796912738519836714353507070181302874783804146314302142802913996845` invalidated by bearer exposure.

If a sender passkey, direct fee path, authoritative funding reread, recipient claim, or reclaim fails during UAT, stop. Do not silently require MetaMask, a conventional wallet, a faucet, or a server-owned sender key.

## Open concerns and next gates

Open concerns are the stable production HTTPS/RP origin, durable WebAuthn/session storage instead of `Kv.memory()`, real sponsor-key custody/rotation/fee balance monitoring, event replay and indexer reconciliation, retry/unknown-receipt handling, and the documented possibility of sponsor-fee waste from concurrent valid fills. Public sender discovery now uses the maintained Tempo indexer plus authoritative vault rereads; local notes remain intentionally session-local.

The next gate is a fresh small recipient UAT only after the masked funded-link UX is exercised and the capability is never pasted or screenshotted. If the compromised payout remains funded after expiry, reclaim it through the sender-only path. Do not add batch UI, API monetization, MPP, mainnet, or marketing work before this money path is proven.

## Phase 2 Human UAT — post-claim evidence

Recorded: 2026-09-23

Human result:
- The owner opened payout 1790060937954, completed a real passkey ceremony, and reached the app’s “Claimed” state.
- No conventional wallet or user-funded gas was used.

### Authoritative payout and transfer

- Chain: Tempo Moderato, chain ID 42431.
- Payout ID: `1790060937954`.
- Final status: `CLAIMED` (`status = 2`).
- Sender: `0x3DF635253f3E0835a4723b93801f5d22461914A5`.
- Recipient/passkey account: `0xAF75774194AbeEC3A0D86693d8A7bC1139311061`.
- Amount: `1` pathUSD (`1,000,000` micro-pathUSD).
- Claim signer: `0xD2A9F2717802aA07F749d9C4b86947afaca96559`.
- Expires at: `1790147340`.
- `PayoutClaimed` event: transaction `0x27ed61eef321032f9bfe60272353cae56eb6aac382989df6f43b212f95c37066`, block `36446266`, log index `5`, recipient above, amount `1,000,000`, with the payout memo.
- Matching `TransferWithMemo`: the same transaction, block `36446266`, log index `4`, from the Reach vault `0x98262c02746f3b91342249159deeebe87a54266c` to the recipient above, amount `1,000,000`.
- Recipient pathUSD balance: `0` at block `36446265`, `1,000,000` at claim block `36446266`, and `1,000,000` currently; the exact increase is `1,000,000`.

### Fee sponsorship

- Claim transaction: `0x27ed61eef321032f9bfe60272353cae56eb6aac382989df6f43b212f95c37066`.
- Transaction sender (`from`): recipient/passkey account `0xAF75774194AbeEC3A0D86693d8A7bC1139311061`.
- Receipt target: Reach vault `0x98262c02746f3b91342249159deeebe87a54266c`.
- Receipt `feePayer`: `0xf625e1F9117d2c7DB2a74862Da3Be141a1195921`, matching the configured Reach sponsor.
- Transaction type: `0x76`; chain ID `42431`; fee token `0x20c0000000000000000000000000000000000000`; receipt status `1`; gas used `590081`; effective gas price raw `15921514725`.
- The receipt proves sponsor payment for the claim transaction; the recipient did not need to fund gas.

### Vault accounting

- Before-claim baseline: vault pathUSD balance and `totalFundedAmount` were `4,000,000`.
- After claim: both read `3,000,000`.
- The difference is exactly `1,000,000`; the remaining `3,000,000` correspond to other abandoned `FUNDED` payouts before the later authorized cleanup above.

### Refresh/revisit recovery

- Direct fragment-free revisit at `/c/1790060937954`: `CLAIMED`; no claim button.
- Browser refresh of that exact fragment-free page: `CLAIMED`; no claim button.
- Both reads used only the public payout state. No WebAuthn call, relay request, non-GET request, or transaction occurred. The spent capability remains deleted and is not needed for terminal recovery.

## Phase 2B.1 — Live human UAT prepared

Preparation date: 2026-09-22

This was a prepared UAT state, not a Phase 2 pass. The owner performed the later cold browser/passkey interaction. No claim button was clicked and no recipient passkey was created by the operator.

### Fresh Moderato operator accounts

- Test sender public address: `0x3DF635253f3e0835a4723b93801f5d22461914A5`
- Test fee-payer public address: `0xf625e1F9117d2c7DB2a74862Da3Be141a1195921`
- Both accounts were freshly generated with `viem/accounts`, used only for this Moderato test, funded through the official `tempo_fundAddress` RPC, and verified on chain `42431`.
- Both accounts held `1,000,000,000,000` pathUSD base units. The corresponding testnet fee balance was also present.
- The private values were stored only in the locked local operator file and are not recorded here.

### Fresh payout

- Payout ID: `1790055969075`
- Amount: `1` pathUSD (`1,000,000` base units)
- Sender: `0x3DF635253f3e0835a4723b93801f5d22461914A5`
- Claim signer: `0x21927cA72266b42611e731423dc6D560f8ea1cc6`
- Expires at: `1790142370`
- Funding transaction: `0xcc45af89452ca5edf0061471b8c814d73a61fe1ccdba21451b00dfcaecf7fcc2`
- Historical current reread: `FUNDED` (`status = 1`), claimant zero, and not expired at preparation time.
- Redacted claim URL: `http://127.0.0.1:5173/c/1790055969075#[REDACTED]`
- The owner later confirmed that no full claim URL was present in the Windows clipboard; this payout was abandoned and later reclaimed after expiry under the cleanup record above. The capability remains intentionally absent from this record, chat, logs, screenshots, and Git.

### UAT environment

- Relay health during UAT: `{"ok":true,"chainId":42431,"sponsorConfigured":true}`
- Historical owner app URL: `http://127.0.0.1:5173/`
- Historical API/relay URL: `http://127.0.0.1:8787/`
- The actual claim route returned HTTP 200 for the fresh payout.

## Phase 2B UAT correction — replacement capability unavailable

Recorded: 2026-09-22

The owner confirmed that the Windows clipboard did not contain the claim URL for payout `1790055969075`. That payout was left untouched until expiry and later reclaimed by the authorized cleanup above.

One replacement payout was attempted exactly once. Its creation reached chain before the clipboard wrapper stopped on a PowerShell stderr-handling error, so its bearer capability was unavailable and it was left untouched until expiry and later reclaimed by the authorized cleanup above:

- Payout ID: `1790058214461`
- Amount: `1` pathUSD (`1,000,000` base units)
- Expires at: `1790144616`
- Funding transaction: `0xcf1da3bfcd7444eb6f464db43f3897aed437727daf347ed9bd98900b72094da7`
- Claim signer: `0x38E8dA19137247143F1CFf27Ce937dC7000df6D8`
- Historical reread: `FUNDED` (`status = 1`), claimant zero.
- Clipboard verification: failed; no Reach claim URL was present.
- No human claim, passkey ceremony, direct contract call, or script claim was performed.

## Phase 2B.2 — Capability delivery correction

Recorded: 2026-09-22

- Resolved operator environment path: `C:\Users\HomePC\Desktop\Reach\.env.local`
- The misplaced sibling file was moved away and removed; `.env.local` is Git-ignored.
- The claim-link flow performed a non-secret clipboard preflight, created the capability before any chain transaction, sent the full URL to the native clipboard helper through stdin rather than command-line arguments, verified the URL and claim signer before funding, and neutralized the clipboard on failure.
- The in-process sentinel and real-link checks passed, but an independent owner-session clipboard read returned empty. Native `clip.exe` also failed the independent sentinel readback. The Windows computer-use helper was unavailable after two initialization attempts. Therefore owner-visible clipboard delivery was not proven in that execution context.
- The later Phase 2B.3 handoff switched local UAT transport to the temporary Git-ignored `.uat/` file, and the owner confirmed the non-secret sentinel there.

The one replacement payout created during this correction was treated as abandoned because its capability could not be delivered safely and was later reclaimed by the cleanup record above:

- Payout ID: `1790059395103`
- Amount: `1` pathUSD (`1,000,000` base units)
- Expires at: `1790145796`
- Funding transaction: `0xa2a1db13c76a416b2852f29d43371ab052e5eaa20084d6c0ca3c55801dd855b6`
- Claim signer: `0x9f84296a7A4eF0d934AC21Cb2dB5525c8aF3ab2f`
- Historical reread: `FUNDED` (`status = 1`), claimant zero.
- The bearer capability was not recorded anywhere.
- No human claim, passkey ceremony, direct contract call, or script claim was performed.

Payouts `1790055969075`, `1790058214461`, and `1790059395103` were reclaimed only after their respective expiries with the real transaction hashes recorded in the Phase 3 pre-phase cleanup section. The claimed payout `1790060937954` was not touched.

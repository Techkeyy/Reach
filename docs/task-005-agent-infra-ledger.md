# TASK 005B — Agent Infrastructure Ledger

Date: 2026-10-10

## Decision

The implementation is locally complete for director-controlled staging review. It is not a production-release recommendation yet: durable production secrets, deployment review, and human UAT on Tempo Moderato are still required. No deployment, push, or live financial transaction was performed during this task.

## Existing versus missing

| Area | Existing before TASK 005 | Implemented / current state | Remaining release gate |
| --- | --- | --- | --- |
| Network | Tempo Moderato, chain `42431`, pathUSD, ReachPayoutVault | All delegated-agent transaction paths remain pinned to Moderato and the configured vault/pathUSD addresses | Human UAT must verify the deployed addresses and successful receipts |
| Vault authority | `ReachPayoutVault` has no owner/admin; direct callers were the effective authority | Delegated use is now an actual Tempo access-key authorization rooted in the authenticated owner account; the server cannot create a policy without the owner session and approval ceremony | Confirm the live wallet/provider supports the exact `wallet_authorizeAccessKey` and `wallet_revokeAccessKey` ceremonies |
| Signer handling | Browser generated/exported `agentPrivateKey`; CLI could load it or `REACH_AGENT_PRIVATE_KEY` | Server generates the signer, encrypts it with AES-256-GCM, stores only ciphertext plus a SHA-256 credential hash, and returns an opaque `reach_agent_...` credential. Browser config and CLI no longer carry a raw agent private key | Provision `REACH_AGENT_ENCRYPTION_KEY` as a server-only 32-byte secret and rotate if exposed |
| Authorization policy | UI described scopes but did not authorize an access key | Owner approves one exact secp256k1 access key with one cumulative pathUSD limit, expiry, pathUSD `approve` to the vault, and vault `createPayout` only. Activation rejects extra limits/scopes, mismatched key/chain/expiry, or wrong root account | Run a connected human UAT ceremony and inspect the resulting onchain authorization |
| Budget safety | Contract tests covered direct allowance behavior, not delegated reservations | Per-payment and cumulative limits are enforced with durable compare-and-set reservations; in-process memory fallback is only for local/test use and production fails closed without durable KV | Verify the production KV credentials and Redis `EVAL` CAS path in staging |
| Replay / concurrency | No agent idempotency ledger | Per-policy idempotency records are durable. Concurrent requests cannot overspend one cumulative budget. Confirmed requests replay their recorded result; failed requests release reservations; unknown settlement never auto-retries | Exercise a live timeout/reconciliation drill before production |
| Revocation / expiry | No complete revoke flow | Server revocation stops future use immediately; UI then calls the owner wallet’s onchain revoke method. Policies expire by timestamp and access-key expiry. In-flight onchain submissions still need ordinary receipt reconciliation | Verify both server and wallet revocation in human UAT |
| Reconciliation | No delegated payment reconciliation | `POST /api/agent/payments/:idempotencyKey/reconcile` reads the authoritative vault payout and confirms only a matching non-`NONE` payout; unknown state remains reserved until then | Test with a real dropped-response / delayed-receipt scenario |
| Agent-to-agent payout | No separate delegated service boundary | `/api/agent/payments` is distinct from normal sender UI funding and uses the owner-approved agent policy; the CLI submits through this API and writes the claim link only to the requested private handoff file | Deterministic local tests pass; live UAT remains pending |
| MPP | No maintained outbound payer or complete session proof | Pinned official `mppx` tooling now provides payee charge/session routes plus bearer-agent payer routes for direct pull charges, session requests, session close, and unknown-payment reconciliation. Direct and session authorizations are separate exact-scope policies. The payer validates origin, chain, pathUSD currency, amount, expiry, recipient, mode, receipt, and redirect behavior; channel state is persisted through the shared KV adapter. Direct pull credentials retain their signed transaction reference before an uncertain response, and the default app reconciler verifies the successful Tempo receipt through RPC before releasing the reservation. | Configure `MPP_SECRET_KEY`, `REACH_MPP_RECIPIENT_ADDRESS`, `REACH_MPP_IDENTITY_SECRET`, durable KV, and optionally the payee settlement key, then run live payment/receipt UAT |

## Endpoints and artifacts

- `POST /api/agent/authorizations` — authenticated owner creates a pending policy and receives the one-time opaque credential plus wallet authorization request.
- `POST /api/agent/authorizations/:id/activate` — authenticated owner commits the wallet-signed access-key authorization after the browser ceremony.
- `POST /api/agent/authorizations/:id/revoke` — authenticated owner disables server use; the UI also requests onchain access-key revocation.
- `POST /api/agent/payments` — bearer agent credential submits an idempotent payout request.
- `GET /api/agent/payments/:idempotencyKey` — reads the durable payment state.
- `POST /api/agent/payments/:idempotencyKey/reconcile` — reconciles an unknown submission against the vault authority.
- `POST /api/mpp/agent-service` — one-time MPP charge.
- `POST /api/mpp/agent-session` — session/metered MPP challenge path.
- `POST /api/mpp/payer/request` — bearer-agent outbound direct pull charge against an allowlisted origin.
- `POST /api/mpp/payer/session` — bearer-agent outbound session request with durable channel state.
- `POST /api/mpp/payer/session/close` — recovers a persisted session channel and submits a signed close credential.
- `POST /api/mpp/payer/:idempotencyKey/reconcile` — resolves an `UNKNOWN` direct MPP payment only when its captured transaction reference has a successful authoritative Tempo receipt; session ambiguity remains reserved until close/settlement.

## Verification evidence

- `pnpm typecheck` — pass after the final lifecycle changes.
- `pnpm build:web` — run as the final release check; Vite’s existing large-chunk warning is non-fatal.
- `pnpm check:api-drift` — required after rebuilding tracked `api/index.js`.
- Delegated authorization tests cover server-only key material, cryptographic owner approval, exact purpose scopes, explicit `allowAnyCalls` rejection, concurrent reservations, revoke/expiry, idempotent replay, unknown payout settlement, and unknown MPP settlement.
- MPP direct proof uses a real MPPx client credential and signed Tempo transaction against a deterministic local RPC executor; the paid response is returned only after MPPx receipt verification.
- MPP session proof uses the real MPPx `sessionManager` and server session method to open/fund a channel, accept two monotonic vouchers, recover the persisted channel in a fresh manager, and close it with a payee-side settlement signer. It does not assert a mocked 200 as payment evidence.
- `pnpm typecheck` — pass.
- `pnpm test:unit` — 162 passed, 0 failed, 0 skipped.
- `pnpm test` — 40 contract/Phase 1-4 and delegated-access tests passed.
- `pnpm exec playwright test --workers=1 --reporter=line` — 73 passed, 0 failed.
- `pnpm build:web` — pass; Vite emitted only the existing large-chunk warning.
- `pnpm check:api-drift` — pass; tracked `api/index.js` matches the source bundle.
- No critical test was intentionally skipped. The previous 153-test baseline is accounted for by 9 new 005B tests, giving the final 162-test unit count.

## Environment required for staging

Set these only in the server environment; never expose them through Vite/browser variables:

- `REACH_AGENT_ENCRYPTION_KEY` — 32 random bytes encoded as hex or base64url.
- `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or the supported Upstash names) — durable production KV.
- `MPP_SECRET_KEY` — MPPx challenge-binding secret.
- `REACH_MPP_RECIPIENT_ADDRESS` — separate service payment recipient; do not use the payout vault.
- `REACH_MPP_PRICE` and optional `MPP_REALM`.
- `REACH_MPP_IDENTITY_SECRET` — server-only HMAC key used to bind application identity to the authenticated payer address and payee recipient for session recovery.
- `REACH_MPP_SETTLEMENT_PRIVATE_KEY` — optional server-only payee key for scheduled session settlement/close; its derived address must equal `REACH_MPP_RECIPIENT_ADDRESS`.
- `REACH_RPC_URL` — must resolve to the same Tempo Moderato chain (`42431`) used by the policy and MPP service.

## 005B security audit and release risks

- Delegated vault and MPP permissions are intentionally disjoint. Vault policies allow only pathUSD `approve` to the configured vault and `createPayout`; direct MPP policies allow only pathUSD `transfer` to exact recipients; session policies allow only the canonical escrow lifecycle selectors plus exact recipients/origins. Broad or admin access keys are rejected.
- Activation verifies the owner-bound signature, exact agent address, chain, type, expiry, single non-recurring pathUSD limit, exact scopes, and live onchain access-key metadata before marking a policy active. Server reservations are atomic and unknown submissions remain reserved until authoritative reconciliation.
- The MPP payer strips caller-supplied payment credentials, forces manual redirect handling, checks exact origin/chain/currency/recipient/mode/expiry, and never follows an unapproved redirect. Direct pull credentials retain their transaction reference for unknown-settlement reconciliation; the MPP service records receipts and session settlement failures in durable KV.
- Remaining risk is operational: no live Moderato payer/payee funds, wallet ceremony, deployed KV CAS, or production deployment was exercised. A director must perform those gates separately. The optional settlement key is a real financial authority and must be provisioned, monitored, and rotated under the deployment’s secret-management controls.

## 005B changed files

- `src/server/agentAuthorization.ts` — exact authorization policy validation, encrypted signer lifecycle, durable payout/MPP ledgers, and reconciliation.
- `src/server/mppPayer.ts` — outbound direct/session payer, challenge/receipt validation, redirect/credential guards, channel persistence, close, and lock handling.
- `src/server/mpp.ts` — durable payee charge/session handlers, identity-bound bootstrap, scheduled settlement hooks, and receipt records.
- `src/server/app.ts` — owner/agent routes for policy lifecycle, payer requests, close, and reconciliation.
- `src/client/AutomationExperience.tsx`, `scripts/agent-payout.ts` — opaque agent credential flow without raw signer delivery.
- `test/agentAuthorization.test.ts`, `test/mpp.test.ts`, `test/mppLocal.test.ts` — adversarial authorization, direct payer/payee, session recovery, and close proofs.
- `.env.example`, `README.md` — secure provisioning and operator workflow.

The previously reported compromised `0.10` claim link was not used, and no mainnet or production financial transaction was attempted.

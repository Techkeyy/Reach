# Reach

Pay people, not wallet addresses.

Reach is BUILDING. Phase 2 has recorded human recipient-claim proof; later sender and Phase 4 outcomes must be checked against [director.md](director.md), not inferred from implementation or deployment.

## Add test funds (current local implementation).

Open `/app`, choose **Add test funds**, and connect your Reach passkey account on `/app/fund`. The screen reads your pathUSD balance, requests the fixed Tempo Moderato faucet once, and only shows success after matching successful receipts and an authoritative balance increase. It also offers **Copy address**, **Check balance**, and **Send money**.

Test funds have no real-world value. Funding is limited to Moderato (42431), with a 10-minute per-address server cooldown. Address ownership is not authenticated at this endpoint; the normal UI supplies the connected account. No sender, sponsor, or deployment private key funds the account.

This feature has completed local validation. Production deployment verification and owner UAT remain separate gates; this repository does not claim funding UAT PASS. See [funding evidence and validation limits](docs/testnet-account-funding.md). No normal financial UAT is automated by this implementation.

## Recipient claim route

The local consumer route is:

```text
http://127.0.0.1:5173/c/<payoutId>#<43-character-base64url-capability>
```

The bearer capability stays in the fragment, is validated and derived locally, and is removed from the address bar before the app reads the payout. A mismatched capability becomes `INVALID LINK`. No third-party analytics or session replay is included.

The UI is mobile-first and value-first: it leads with the amount, explains that a passkey is used, and does not require a wallet app, a user-funded gas balance, or blockchain terminology for the primary action.

## Local development

```text
pnpm install --frozen-lockfile
pnpm dev
```

The frontend runs at `http://127.0.0.1:5173`; the Hono API/WebAuthn/relay server runs at `http://127.0.0.1:8787`. Set `REACH_FEE_PAYER_PRIVATE_KEY` only in the server environment to enable sponsorship. It must never be a `NEXT_PUBLIC_*` variable or browser secret.

To create a sender-side test payout after setting `TEMPO_DEPLOYER_PRIVATE_KEY`:

```text
pnpm create:claim-link
```

The script approves pathUSD, creates a funded payout in the current deployed vault, and prints a one-time local claim link. It does not write the capability to a file.

## Delegated agents and MPP

The `/app/automation` Agents screen creates a server-held secp256k1 signer, then asks the connected passkey owner to approve a Tempo access-key authorization for the exact pathUSD budget, expiry, MPP purpose, recipient, and service origin. The normal user journey stays in Reach: there is no configuration download, CLI step, manual API call, or preassigned wallet. Only the opaque bearer session credential is kept in this browser session; the signer private key never reaches the browser. The server requires `REACH_AGENT_ENCRYPTION_KEY` and durable KV in production, reserves cumulative budget atomically, records idempotency keys, and keeps an unknown settlement reserved until it is reconciled.

MPP permissions are separate least-privilege policies. A `MPP_DIRECT` policy permits only pathUSD `transfer` to its exact recipient allowlist; a `MPP_SESSION` policy permits only the canonical MPP escrow lifecycle selectors and still requires an exact recipient and origin allowlist. Neither policy can be used for vault payouts, and vault policies cannot be used for MPP. Activation verifies the owner signature and the corresponding live Tempo access-key metadata before the policy becomes active.

The existing CLI remains an optional server-to-server compatibility path for vault payout automation. It is not part of the normal Agents or MPP user journey:

```text
pnpm tsx scripts/agent-payout.ts --config ./reach-agent-config.json --amount 10.00 --claim-output ./private-claim-link.txt
```

MPP one-time charges are available at `/api/mpp/agent-service`; session/metered charges are available at `/api/mpp/agent-session`. They require `MPP_SECRET_KEY` and a separate `REACH_MPP_RECIPIENT_ADDRESS`. Both use the installed official [MPPx](https://github.com/wevm/mppx) implementation, pathUSD on Moderato, and the shared durable KV replay/channel store. The outbound payer endpoints are bearer-agent routes: `POST /api/mpp/payer/request` for a direct pull charge, `POST /api/mpp/payer/session` for a metered session request, `POST /api/mpp/payer/session/close` to recover and close a persisted channel, and `POST /api/mpp/payer/:idempotencyKey/reconcile` for an ambiguous direct submission. Direct pull credentials retain their signed transaction reference before an uncertain response, and the default app reconciler verifies the successful Tempo receipt through RPC before releasing the reserved budget; session ambiguity remains reserved until close/settlement. Payer URLs must use an exact policy origin; redirects, payment headers supplied by the caller, unapproved recipients, unsupported chains/currencies/modes, and over-budget challenges are rejected.
MPP one-time charges are available at `/api/mpp/agent-service`; session/metered charges are available at `/api/mpp/agent-session`. They require `MPP_SECRET_KEY` and a separate `REACH_MPP_RECIPIENT_ADDRESS`. Both use the installed official [MPPx](https://github.com/wevm/mppx) implementation, pathUSD on Moderato, and the shared durable KV replay/channel store. The Agents screen calls the payer endpoints after owner approval, then renders the actual paid response and the authenticated financial record. Owner discovery is provided by `GET /api/agent/authorizations` and `GET /api/agent/authorizations/:id/payments`. The outbound payer endpoints are bearer-agent routes: `POST /api/mpp/payer/request` for a direct pull charge, `POST /api/mpp/payer/session` for a metered session request, `POST /api/mpp/payer/session/close` to recover and close a persisted channel, and `POST /api/mpp/payer/:idempotencyKey/reconcile` for an ambiguous direct submission. Direct pull credentials retain their signed transaction reference before an uncertain response, and the default app reconciler verifies the successful Tempo receipt through RPC before releasing the reserved budget; session ambiguity remains reserved until close/settlement. Payer URLs must use an exact policy origin; redirects, payment headers supplied by the caller, unapproved recipients, unsupported chains/currencies/modes, and over-budget challenges are rejected.

Session recovery binds the application identity header to the authenticated Tempo payer address and the configured recipient. Set `REACH_MPP_IDENTITY_SECRET` for a deployment that must recover sessions across workers; set `REACH_MPP_SETTLEMENT_PRIVATE_KEY` only when the payee should submit scheduled settlement/close transactions, and use a key whose address exactly equals `REACH_MPP_RECIPIENT_ADDRESS`. Keep both secrets server-only. A failed or timeout-like MPP submission remains `UNKNOWN` with its budget reserved; it is never retried automatically.

Legacy claim-link files and optional CLI agent credentials are bearer material. Keep them outside source control and rotate/revoke the agent authorization if either is exposed. The normal Agents screen never downloads these values.

## Verification

```text
pnpm typecheck
pnpm build:web
pnpm test                 # 40 contract/Phase 1-4 and delegated-access tests
pnpm test:phase2          # capability and relay-boundary tests
pnpm test:unit             # complete unit/server suite, including delegated auth and MPP
pnpm test:all              # API drift, contract, and complete unit regression
pnpm exec playwright test --workers=1 --reporter=line
```

Phase 1 contract evidence remains in [docs/moderato-live-evidence.md](docs/moderato-live-evidence.md). Phase 2 implementation and gate status are in [director.md](director.md).

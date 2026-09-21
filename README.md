# Reach

Pay people, not wallet addresses.

Reach is BUILDING. Phase 2 has a real recipient claim route and automated browser redaction proof, but the cold passkey ceremony and live zero-gas sponsored claim remain UAT gates. See [director.md](director.md) for the exact evidence state.

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

## Verification

```text
pnpm typecheck
pnpm build:web
pnpm test                 # 25 Phase 1 vault tests
pnpm test:phase2          # capability and relay-boundary tests
pnpm test:browser         # Playwright capability-leakage/state tests
```

Phase 1 contract evidence remains in [docs/moderato-live-evidence.md](docs/moderato-live-evidence.md). Phase 2 implementation and gate status are in [director.md](director.md).

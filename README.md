# Reach

Passkey-powered human payments on Tempo.

Reach helps one person pay another without collecting a wallet address first. A sender creates a pathUSD payment, shares a private claim link, and the recipient claims through a passkey-secured account. Reach is a human-payments application focused on Fast Payments, Protected Payments and Batch Payments.

## Product

### Fast Payments

Create a single pathUSD payment for a recipient, choose an expiry window, and share the private claim link. The sender can review the payment in Activity and reclaim it after expiry when it remains unclaimed.

### Protected Payments

Add recipient verification to a payment before the claim is released. The supported protection flow keeps the claim capability private and records the resulting payment state for the sender and recipient.

### Batch Payments

Create several payments in one guided flow, review each recipient and amount, and keep the individual claim links separate. Batch funding uses the same payout vault and activity/recovery boundaries as a single payment.

## Recipient claims

Claim links use a private capability in the URL fragment:

```text
http://127.0.0.1:5173/c/<payoutId>#<private-capability>
```

The capability is validated and derived in the browser. It is not sent to third-party analytics or stored in the server-side activity index. An invalid or mismatched link is rejected. A recipient can create or return to a passkey account as part of the claim flow.

## Network and status

Reach is built for the Tempo Moderato testnet, chain `42431`, using pathUSD. Testnet funds have no real-world value. Funding and payment results must be verified from authoritative receipts and balances; this repository does not claim production financial UAT merely because the code or local tests pass.

The payment vault is designed to keep sender funding, recipient claiming and expiry/reclaim state explicit. Reach does not require the recipient to install a wallet application or hold a separate gas token for the normal claim journey.

## Local development

```text
pnpm install --frozen-lockfile
pnpm dev
```

The frontend runs at `http://127.0.0.1:5173`; the Hono API/WebAuthn/relay server runs at `http://127.0.0.1:8787`. Server-only fee-payer configuration belongs in the server environment and must never be exposed through a browser-prefixed variable.

To create a sender-side test claim link after setting the authorized local testnet sender configuration:

```text
pnpm create:claim-link
```

The script is for local/testnet development. It must not be used with production credentials or an unapproved live transaction.

## Verification

```text
pnpm typecheck
pnpm build:web
pnpm test
pnpm test:phase2
pnpm test:browser
```

The regression suite covers passkey registration and return login, funding and balance reads, single and batch payment preparation, protected claims, recipient claiming, expiry/reclaim, activity recovery and authorization boundaries. Current evidence and limitations are recorded in [director.md](director.md) and the supporting documents under [docs](docs).

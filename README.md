# Reach

**Send testnet stablecoin payments to people, including recipients who do not already have a wallet address.**

[Live Reach app](https://reach-seven-lemon.vercel.app/) · [Desktop and mobile screenshots](docs/images/) · [Payout vault](contracts/ReachPayoutVault.sol) · [Architecture notes](docs/architecture-decision.md)

![Reach landing page with the official two-person icon and payment handoff illustration](docs/images/reach-landing-desktop.png)

Reach is for a sender who knows *who* they want to pay but does not want to collect a crypto address first. The sender funds a payout, shares a private claim link, and the recipient opens a passkey-secured account to claim it.

> How do I pay this person if they have not set up a wallet?

Built for the Crypto World's Fair at Colosseum. Reach currently runs on **Tempo Moderato testnet (chain 42431)** with **pathUSD test tokens, not real money**.

## The handoff, not the address

An address-first transfer makes the recipient's wallet setup a prerequisite. Reach separates funding from claiming: the sender can prepare a funded entitlement, then give the recipient a private link. The recipient completes account entry and claiming in Reach. This is a product choice, not a claim that payment links or passkey wallets are unique to Reach.

```text
Sender's passkey account → funded payout vault → private claim link
                                              → recipient's passkey account
                                              → claim or sender reclaim after expiry
```

## Three ways to pay

| Experience | What the sender does | Recipient handoff |
| --- | --- | --- |
| Fast Payment | Reviews one amount and expiry, then funds a payout. | Shares its private claim link. |
| Protected Payment | Adds an available recipient-verification channel before funding. | Recipient completes that check before the claim capability is released. |
| Batch Payment | Reviews multiple recipients and payouts in one guided flow. | Keeps a separate claim link and status for each recipient. |

The public page and account entry are pictured below. These are captures of the reviewed browser UI, **not** evidence of a completed financial transaction.

| Mobile landing | Account entry | Payment modes |
| --- | --- | --- |
| ![Reach mobile landing](docs/images/reach-landing-mobile.png) | ![Reach account entry](docs/images/reach-account-entry.png) | ![Reach Fast, Protected and Batch section](docs/images/reach-payment-modes.png) |

## How a payment moves

1. **Open:** Create or return to a passkey account. Reach displays the account address and reads its testnet balance.
2. **Fund:** Add test tokens through the Funding screen when its service is available, or use an already funded testnet account.
3. **Approve:** Choose Fast, Protected or Batch, review the amount and expiry, and approve the account transaction that funds the vault.
4. **Share:** Give each recipient their private link. The claim capability is in the URL fragment, not a public payout index.
5. **Resolve:** The recipient signs in or registers with a passkey and claims. Activity reads payout state and receipts; after expiry, only the original sender can reclaim an eligible unclaimed payout.

An unprotected link is a **bearer capability**: possession of the complete link matters. Send it privately. If genuinely lost, Reach cannot recreate its secret from public payout data. Protected Payments add a separate verification step but depend on correctly configured delivery providers.

## Try it locally

Prerequisites: Node.js 24.14+, pnpm 11.19+, and a browser with passkey support. From the repository root:

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm run doctor
pnpm dev
```

Open `http://localhost:5173`. `pnpm run doctor` checks runtime, dependencies and configuration **without printing secret values**. Use `pnpm run doctor`, not bare `pnpm doctor`, which invokes pnpm's own unrelated command. If your system cannot run both dev processes reliably, run the fixture and contract checks below in a healthy Linux environment; the Windows sandbox used for this project has intermittently returned `uv_os_get_passwd` / `ENOMEM` before the API starts.

The example file contains **names and public testnet defaults only**. Do not commit `.env.local`, use a production signing key, or put a secret in a `VITE_*` variable. Local memory storage can exercise UI and tests, but it cannot preserve passkey accounts across server restarts. A deployed account requires durable KV and a matching HTTPS `REACH_ORIGIN` / `REACH_RP_ID`. Sponsorship and Protected Payment delivery require additional server-only configuration; missing services must be treated as unavailable, not simulated.

You can verify the core logic without a wallet, test tokens or a live transaction:

```sh
pnpm typecheck
pnpm test:unit
pnpm test
pnpm exec playwright test --workers=1 test/browser/task015-landing.spec.ts
```

`pnpm test` runs local Hardhat contract simulation. Browser tests use fixtures or local services; they do not establish that a real deployed payment settled. The broader browser suite is `pnpm test:browser`.

## What holds the money, and what does not

| Part | Job |
| --- | --- |
| [`ReachPayoutVault.sol`](contracts/ReachPayoutVault.sol) | Holds funded pathUSD entitlements and enforces claim, expiry and sender reclaim. |
| [`src/client`](src/client/) | Presents passkey entry, funding, send, claim and Activity journeys. |
| [`src/server/app.ts`](src/server/app.ts) | Serves authentication, read APIs, protected delivery and guarded sponsorship routes. |
| [`src/server/kvAdapter.ts`](src/server/kvAdapter.ts) | Persists sessions and private workflow state with durable server-side KV. |
| [`src/shared/reach.phase2.ts`](src/shared/reach.phase2.ts) | Pins Tempo, pathUSD and shared contract interfaces. |

The client is React, TypeScript and Vite. The API uses Hono and the Accounts WebAuthn library; chain reads and account operations use viem/wagmi. The payout vault is Solidity tested with Hardhat. The deployed testnet configuration uses a server-side Upstash-compatible Redis REST adapter. The server has operational authority for passkey sessions, optional recipient verification and fee sponsorship, **not** custody of the vault's funded payout balance. [Read the authorization decision](docs/architecture-decision.md).

## How we tried to break it

These are **local automated test results**, not deployed financial UAT:

| Adversarial case | Observed local result | Evidence |
| --- | --- | --- |
| Wrong signer, changed recipient, payout, vault or chain | Claim authorization rejected. | [`test/ReachPayoutVault.ts`](test/ReachPayoutVault.ts) |
| Duplicate claim or claim after reclaim | Only one terminal payout transition wins. | [`test/ReachPayoutVault.ts`](test/ReachPayoutVault.ts) |
| Malformed or missing private-link fragment | Parser rejects it without inventing a capability. | [`test/claimLink.test.ts`](test/claimLink.test.ts) |
| Wrong authenticated sender for Protected Payment registration | Server refuses the write. | [`test/serverApp.test.ts`](test/serverApp.test.ts) |
| Concurrent one-time challenge reads | One caller receives the challenge in the local KV and mocked REST concurrency tests. | [`test/serverApp.test.ts`](test/serverApp.test.ts) |
| Receipt missing or uncertain | Recovery keeps the state uncertain instead of claiming settlement. | [`test/claimRecovery.test.ts`](test/claimRecovery.test.ts) |

**A missing authoritative receipt is not a confirmed payment.** On 12 October 2026, the reviewed local candidate passed 155/155 unit/server tests and 36/36 local contract tests. Browser and deployed results, including any host-specific failures, are recorded in [`director.md`](director.md); those results are not a substitute for owner-run real testnet payment acceptance.

## Current status and limits

- Reach is a **testnet** application. It is not a mainnet payment service, bank transfer or fiat off-ramp.
- The reviewed UI and deterministic tests do not prove the full deployed fund → send → claim → reconcile journey. Real financial UAT remains pending and requires separately approved transactions.
- A private claim link cannot be regenerated if its capability is lost. Device/browser passkey recovery options vary; Reach cannot guarantee recovery of a lost credential.
- Protected delivery depends on server-only SMS or email provider configuration. Claim fee sponsorship is conditional on its server service being available.
- The official testnet URL served this candidate's web asset fingerprints on 12 October 2026. GitHub `main` and anonymous repository visibility are still not verified as aligned for judging. No demo video is linked until one is actually published.

The Tempo integration previously surfaced a token return-data discrepancy; the exact observation and boundary are in [`docs/live-discrepancy.md`](docs/live-discrepancy.md). No external issue or contribution is claimed here.

License: no project license has been declared by the owner yet.

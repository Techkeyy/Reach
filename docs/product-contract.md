# Reach Product Contract

## PRODUCT

Reach

## INTENDED USERS

- Individual sender.
- Business or operator creating batch payouts.
- Payout recipient.
- Developer or API customer integrating human payout workflows.

## CORE PROBLEM

People and businesses should not have to collect blockchain wallet addresses before they can pay someone.

## CORE PROMISE

Create a real funded payout for someone before they are already a crypto user.

## PRIMARY HAPPY PATH

sender
→ create payout
→ fund payout
→ receive claim URL
→ recipient opens URL
→ recipient authenticates
→ recipient claims
→ real onchain settlement
→ sender/dashboard observes confirmed state

## FINAL OUTCOME

Recipient owns the payout funds and the authoritative system reports the payout as claimed.

## Product boundary

Reach is a payout entitlement system, not a generic payment link. The recipient does not need to supply a wallet address to the sender. The v1 recipient claim is a bearer-link flow secured by a high-entropy one-time secret and a supported Tempo account ceremony. That means whoever obtains the complete claim link may attempt the claim. Reach will not describe the link as identity-bound until an additional recipient-verification mechanism exists.

## Actors

| Actor | Job | Direct interaction |
|---|---|---|
| Sender | Creates and funds a payout | Yes |
| Recipient | Opens a link and claims funds | Yes |
| Business operator | Imports or creates many payouts and monitors state | Yes |
| Developer | Calls the API and reconciles results | Yes |
| Tempo account or passkey | Authorizes recipient claims where supported | Through Reach |
| Payout vault | Enforces entitlement, claim, expiry, and reclaim | No direct UI |
| Tempo network | Settles the token transfer and records lifecycle events | No direct UI |
| Metadata database | Stores private descriptions, idempotency, and derived status | No direct UI |
| Fee sponsor | Pays eligible transaction fees | No direct UI |

## User journey and behind-the-scenes journey

| User does | System does |
|---|---|
| Enters amount, token, reason, and expiry | Validates integer token units, supported token, expiry bounds, and sender scope |
| Clicks fund | Builds approval plus vault funding calls, ideally atomically through Tempo batching |
| Confirms the transaction | Vault transfers exact tokens into its own balance and emits a created event |
| Copies the claim link | Link contains payout ID and a one-time secret in a fragment; backend stores only commitment or encrypted API secret |
| Opens the link | Client reads public payout metadata and displays value before technical details |
| Creates or uses a passkey account | Tempo account connector completes supported WebAuthn ceremony |
| Clicks Claim | Account signs the vault claim call; fee sponsor is requested only when the flow is proven |
| Waits for confirmation | Client and backend read vault state and lifecycle event, then show claimed |
| Refreshes sender view | Backend reconciles from chain events and the frontend never treats optimistic state as claimed |

## The magic moment

The recipient sees “Alex sent you $25” and can claim it without first giving Alex a wallet address.

Everything that must work for that moment: funded vault entitlement, unguessable secret commitment, valid mobile claim route, supported passkey account creation, sponsored or otherwise usable claim fees, exact token transfer, and authoritative claimed-state reconciliation.

## Core loop

Create entitlement → fund vault → authenticate claimant → atomically claim or reclaim → reconcile state.

## State model

The application must distinguish these states where applicable:

`REQUESTED`, `AWAITING FUNDING`, `FUNDED`, `CLAIMING`, `CLAIMED`, `EXPIRED`, `RECLAIMING`, `RECLAIMED`, `FAILED`, and `UNKNOWN`.

Onchain lifecycle states are intentionally smaller: `FUNDED`, `CLAIMED`, and `RECLAIMED`. The offchain state machine maps transaction and reconciliation uncertainty around them. The UI must never show `CLAIMED` until an authoritative chain read or confirmed event proves it.

## Onchain versus offchain

### Onchain

- Payout ID, token, exact amount, sender, expiry, commitment, lifecycle status, claimant, and lifecycle events.
- The funded token balance held by the payout vault.
- Claim and reclaim authorization rules.

These belong onchain because the financial entitlement and its one-winner state transition must not depend on a mutable operator ledger.

### Offchain

- Reason, recipient label, batch/import metadata, API idempotency records, encrypted API claim secret where required, reconciliation cursor, and UI cache.
- Claim URL routing and delivery choices.

These stay offchain because they are private, changeable, or operational. The backend remains trusted for metadata and availability, not for ownership of funded payout balances.

## Explicit non-goals

- No pooled hot-wallet accounting.
- No fiat withdrawal or bank transfer.
- No cross-chain support.
- No recipient-selected settlement asset until current Tempo liquidity and exchange support are proven.


# Reach Architecture Decision

Status: selected candidate, pending contract tests and live integration proof.

## Decision in one sentence

Reach will represent each funded payout as an individual entitlement in a non-upgradeable Tempo smart contract vault, while the backend stores private metadata and derived reconciliation state but never owns pooled payout funds.

## The money question

When a sender funds $25 for a future recipient, the $25 lives as the exact token amount in the vault contract’s balance, associated with one payout ID and one claim commitment. It does not live as an offchain database balance and it is not commingled in an operator hot wallet for later discretionary settlement.

The intended authorization is a two-part bearer flow: possession of a high-entropy one-time secret from the claim link plus authorization by the Tempo account that submits the claim. The contract accepts the secret only once for the payout and sends the fixed amount to the submitting recipient account. This is not identity-bound recipient verification. If the complete link is stolen before claim, the holder can attempt the claim, so URL handling and user disclosure are part of the threat model.

## Options considered

### A. Dedicated smart-contract/vault entitlement

**Decision: SELECTED.**

The vault stores `token`, `amount`, `sender`, `expiry`, `claimCommitment`, `status`, and `claimant` per payout. `createPayout` pulls the exact token amount into the vault. `claim` verifies the secret commitment, requires `FUNDED`, sets `CLAIMED`, records the claimant, and transfers the fixed amount. `reclaim` requires `FUNDED` and `block.timestamp >= expiry`, sets `RECLAIMED`, and returns the exact amount to the sender.

Why it fits: it gives one authoritative place for funds and state, makes claim/reclaim races atomic, removes operator discretion from payout balances, and is auditable by contract tests and chain events. The cost is contract security responsibility, token-allowlist configuration, and the need to prove passkey calls against the deployed chain.

### B. Current Tempo-native primitive without custom escrow

**Decision: REJECTED for the core entitlement.**

Tempo provides native TIP-20 payments, transfer memos, fee sponsorship, passkey-oriented accounts, and atomic batching. These remove plumbing and improve the funding and claim UX, but the inspected official sources do not provide a native primitive that holds a future-recipient entitlement with a secret, one-time claim, expiry, and sender reclaim. A direct TIP-20 transfer cannot pay someone who has no recipient account address yet.

Reach will reuse Tempo’s primitives around the vault instead of rebuilding them: batching for approval plus funding, TIP-20 units and memos for reconciliation where suitable, WebAuthn accounts for the recipient, and fee sponsorship for claims.

### C. Backend/operator-controlled custody

**Decision: REJECTED.**

The backend could receive sender funds into a hot wallet, store an offchain balance, and later send to whichever account claims a link. That makes the backend the authority for ownership, accounting, expiry, and recovery. A database outage, key compromise, retry bug, or operator mistake could create loss or double settlement. It also contradicts the product promise’s strongest safety property. Backend custody is not the v1 architecture.

## Proposed contract interface

This is an interface sketch, not deployed code.

```solidity
enum Status { FUNDED, CLAIMED, RECLAIMED }

struct Payout {
    address token;
    address sender;
    uint128 amount;
    uint64 expiry;
    bytes32 claimCommitment;
    Status status;
    address claimant;
}

function createPayout(
    address token,
    uint128 amount,
    bytes32 claimCommitment,
    uint64 expiry,
    bytes32 reference
) external returns (uint256 payoutId);

function claim(uint256 payoutId, bytes32 secret) external;
function reclaim(uint256 payoutId) external;
function getPayout(uint256 payoutId) external view returns (Payout memory);
```

The actual interface may change after the first compile and security review. No upgradeability is planned for v1.

## Invariants and race behavior

1. A payout starts `FUNDED` only after the exact token transfer into the vault succeeds.
2. `claim` requires `status == FUNDED`, `keccak256(secret) == claimCommitment`, and a non-expired claim boundary as defined in the final contract.
3. `reclaim` requires `status == FUNDED` and the expiry boundary.
4. Both functions change status before calling the external token contract. If the token transfer reverts, the entire transaction reverts, including the state update.
5. A claim and reclaim racing in separate transactions cannot both succeed because the first committed transaction changes the shared status; the other reverts.
6. A successful claim cannot be reclaimed because status is no longer `FUNDED`.
7. A successful reclaim cannot be claimed because status is no longer `FUNDED`.
8. The payout ID, token, and amount are fixed after creation. The backend cannot change them.
9. Supported token addresses are allowlisted or otherwise constrained to known TIP-20 stablecoins. Arbitrary-token support is not assumed.
10. Financial amounts use integer token units and `bigint` in TypeScript. Floating point is forbidden in accounting paths.

## Claim secret and URL design

- Generate at least 32 random bytes with a cryptographically secure browser or server primitive.
- Store `keccak256(secret)` onchain. Never store the plaintext secret onchain or in ordinary logs.
- Prefer a URL shaped like `https://reach.example/claim/<payoutId>#s=<secret>` so the fragment is not sent in the normal HTTP request or Referer header.
- The claim client reads the fragment and supplies the secret only to the claim transaction.
- The direct browser sender flow may retain the plaintext secret only in the browser long enough to construct the link.
- API and MPP flows need deterministic idempotent responses, so their server-generated secret may be encrypted at rest under `CLAIM_SECRET_ENCRYPTION_KEY`. Plaintext is returned only inside the claim URL response and must not be logged.
- The URL is a bearer credential. Browser history, screenshots, link previews, clipboard managers, analytics, chat logs, referrers, and compromised devices are leakage risks. Reach must avoid third-party analytics on claim routes and explain link privacy in the UI.

## Funding flow

1. Client creates a one-time secret and commitment, or the API server creates and encrypts it for an idempotent API request.
2. Client validates token, integer amount, expiry, and sender account.
3. Client prepares `approve(vault, amount)` and `createPayout(...)` calls.
4. Tempo native batching is used where the actual connector supports it, so allowance plus funding is atomic. If not supported, the UI must show separate approval and funding states and retain the same payout intent.
5. The vault pulls the exact amount via `transferFrom` and emits `PayoutCreated`.
6. The backend records metadata and reconciles the receipt. A transaction with an unknown result is never automatically resent.

## Claim flow

1. Claim page displays amount, token, sender label when available, and reason before asking for account setup.
2. Recipient chooses `Create your account` or uses an existing supported Tempo account.
3. Client reads onchain payout state before enabling claim.
4. Recipient account signs the vault claim call with the secret from the URL fragment.
5. Fee sponsorship is requested only for the exact claim call after the passkey and sponsor path passes live browser testing.
6. Client waits for confirmation and reads the vault state or event. It shows `You received` only after `CLAIMED` is authoritative.

## Expiry and reclaim

Expiry is a contract timestamp chosen at creation within bounded product limits. The final boundary convention will be written into tests and UI, not assumed from prose. After expiry, the sender may reclaim only while the payout remains `FUNDED`. Reclaim uses the same state check as claim, so the race has one winner. Reclaim is an explicit action with a clear pending state. A reclaim transaction with unknown receipt is reconciled before retry.

## Event and reconciliation model

The contract emits lifecycle events containing payout ID, token, amount, sender, claimant or reclaim recipient, and a short reference. The backend persists a cursor and derives a searchable index. A restart replays events idempotently from the deployment block or cursor. The frontend reads the vault directly for critical state and uses backend metadata for labels and lists.

Authoritative truth ordering:

1. Confirmed vault storage and logs on the configured Tempo network.
2. Confirmed transaction receipt for the state-changing action.
3. Backend reconciliation record.
4. Optimistic local UI state, which is never enough to say `CLAIMED`.

## API idempotency

Each create request requires an idempotency key. The backend stores the sender scope, key, normalized intent hash, payout ID, and transaction identifiers. The same key plus the same intent returns the original record. The same key plus a different intent is rejected. If the original transaction is `UNKNOWN`, the API returns `UNKNOWN` and reconciles; it does not create a new funded payout or blindly resend.

## Mass payout behavior

Business batches are not a fake table over unexecuted records. Each row gets a real payout ID, exact amount, claim commitment, and lifecycle event. Batch atomicity and payload limits will be measured before promising a single transaction. If one transaction is too large, Reach will use explicit chunks with per-chunk status and no hidden partial success. Tempo batching is a candidate primitive, not yet proven at the target batch size.

## Trust model

The vault removes operator discretion over funded entitlement state, but Reach still trusts the token issuer, Tempo network, RPC availability, key manager or account provider, fee sponsor, backend metadata availability, and the recipient’s possession of the link. Reach is not described as fully trustless or fully non-custodial.

## Recovery

On backend restart, replay chain events and reconcile pending records. On browser refresh, never resubmit a state-changing action solely because the UI lost local state. Query the payout by ID and inspect the receipt before offering a retry. If a claim link is lost, the direct browser sender cannot recreate it from a hash alone; the API path may recreate it only from encrypted server storage, subject to access control.

## Why this remains the smallest safe architecture

The vault is the smallest component that can own the future entitlement and make claim/reclaim mutually exclusive. The backend is limited to private metadata, indexing, idempotency, and UX coordination. Tempo primitives are reused for payments, batching, fees, accounts, and reconciliation rather than recreated in custom infrastructure.


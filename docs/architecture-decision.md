# Reach Architecture Decision — Phase 1

> Historical Phase 1 design record. The vault authorization model below remains relevant; its original status and test counts describe that phase, not the current deployed application's complete acceptance state. See the [current README](../README.md) and supporting evidence documents for the public release scope and proof boundary.

Status: selected architecture implemented locally and proven in a fresh Moderato integration; browser/API layers remain unproven.

## Decision

Reach represents every funded payout as an individual entitlement in a non-upgradeable `ReachPayoutVault` on Tempo. The backend stores metadata and reconciliation state only; it never owns pooled payout funds or sender signing keys.

The deployed v1 vault has one immutable TIP-20 token address. This keeps token policy and accounting explicit while the live pathUSD integration is proven.

## Rejected authorization model

The old `claimCommitment = keccak256(secret)` plus `claim(payoutId, secret)` model is rejected. A plaintext secret in a public transaction is visible to mempool observers and can be copied into a competing transaction before the intended recipient. Passing a different recipient would also make a stolen capability redirectable.

The current model stores a public one-time `claimSigner` address. The client holds the corresponding secp256k1 private key only as a bearer capability, preferably in a URL fragment. The private key never enters onchain storage, claim calldata, events, logs, analytics, or Git. The link is still bearer authorization and is not identity verification.

## Contract surface

```solidity
enum Status { NONE, FUNDED, CLAIMED, RECLAIMED }

struct Payout {
    address sender;
    uint256 amount;
    uint64 expiresAt;
    address claimSigner;
    Status status;
    address claimant;
}

function createPayout(
    uint256 payoutId,
    uint256 amount,
    address claimSigner,
    uint64 expiresAt
) external;

function claim(
    uint256 payoutId,
    address recipient,
    bytes calldata claimAuthorizationSignature
) external;

function reclaim(uint256 payoutId) external;
function getPayout(uint256 payoutId) external view returns (Payout memory);
function hashClaimAuthorization(uint256 payoutId, address recipient) external view returns (bytes32);
```

`createPayout` rejects zero IDs, zero amount, zero signer, invalid expiry, and reuse. It pulls the exact amount from the sender in the same transaction and sets `FUNDED` only inside that atomic transaction. A failed token call reverts the record and balance change.

## Signature scheme

OpenZeppelin Contracts `5.6.1` supplies `EIP712` and `ECDSA`; no hand-rolled recovery is used.

- Domain name: `Reach Payout Vault`
- Domain version: `1`
- Domain fields: standard EIP-712 `chainId` and `verifyingContract`
- Primary type: `Claim`
- Type: `Claim(uint256 payoutId,address recipient,bytes32 action,uint256 version)`
- Action: `keccak256("ReachPayoutVault.claim")`
- Version: `1`

The recovered signer must equal the payout's `claimSigner`. The supplied `recipient` is the signed destination. Therefore:

- Alice's valid signature with `recipient = Alice` is accepted.
- The same signature with `recipient = Attacker` reverts.
- An attacker may submit the exact unchanged Alice transaction first, but the transfer still lands at Alice.
- A signature for another payout, another vault address, or another chain domain reverts.

The contract performs effects before the external token call under OpenZeppelin `ReentrancyGuard`. A revert or false/empty-incompatible token response rolls the full transaction back.

## State and boundary

The only terminal paths are `NONE -> FUNDED -> CLAIMED` and `NONE -> FUNDED -> RECLAIMED`. Claim requires `block.timestamp < expiresAt`; reclaim requires `block.timestamp >= expiresAt` and the original sender. The boundary leaves no timestamp at which both are valid. `totalFundedAmount` tracks the sum of live `FUNDED` records and local tests compare it to the vault token balance.

## TIP-20 integration decision

Tempo Standard Library's current `ITIP20` exposes `approve`, `transferFrom`, `transferFromWithMemo`, `transferWithMemo`, and `permit`. Reach uses payout ID as a `bytes32` memo for funding, claim, and reclaim.

The live Moderato pathUSD address accepted the memo calls but returned empty data from `transferWithMemo`, despite the published interface declaring a boolean return. The vault uses a narrow low-level call wrapper that accepts empty success or explicit `true`, rejects revert/explicit `false`, and never calls an arbitrary token address beyond the deployment's immutable token. The discrepancy and fresh retry are recorded in `docs/live-discrepancy.md` and `docs/moderato-live-evidence.md`.

## Backend and URL trust boundary

The preferred client flow generates the key and returns a fragment-only bearer link. The backend stores `claimSigner`, public payout metadata, idempotency records, and reconciliation state. It does not need to know the private key. A future server-generated API capability must be encrypted at rest and explicitly documented as a backend trust boundary; it is not part of Phase 1.

The fragment reduces normal HTTP Referer leakage but does not prevent screenshots, browser history, clipboard, chat, preview, or compromised-device leakage. Claim routes must avoid third-party analytics and redact the fragment from logs.

## Evidence boundary

Exact implementation: `contracts/ReachPayoutVault.sol`.

Local proof: 25 passing adversarial tests in `test/ReachPayoutVault.ts`; `tsc --noEmit` succeeds.

Live proof: fresh vault on Moderato with create/fund, recipient-bound EIP-712 claim, recipient balance delta, storage `CLAIMED`, second payout expiry/reclaim, and pathUSD memo events. This proves the contract and live token integration only; it does not prove passkey onboarding, sponsored fees, backend reconciliation, or product readiness.

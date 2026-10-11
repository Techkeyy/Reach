# Reach Phase 1 — Payout Vault and Safe Claim Authorization

Status: local contract proof complete; live Moderato integration pending a disposable funded test account.

## Authorization decision

The Phase 0 raw bearer-secret model was rejected before implementation. A `keccak256(secret)` plus `claim(secret)` design is front-runnable: the secret is visible in the public transaction and an observer could copy it into a competing transaction. It also leaves the contract unable to bind the claim to a destination without changing the calldata model.

Reach now uses a one-time claim signer:

1. The client generates a cryptographically secure one-time secp256k1 private key and derives `claimSigner`.
2. The sender funds `createPayout(payoutId, amount, claimSigner, expiresAt)` atomically. Only the public signer address is stored onchain.
3. The private claim capability is carried in the URL fragment or equivalent bearer representation. It is never calldata, event data, logs, analytics, or repository content.
4. The recipient signs EIP-712 authorization for the exact payout and destination.
5. `claim(payoutId, recipient, claimAuthorizationSignature)` recovers the claim signer and transfers only to the signed recipient. A relayer may submit the transaction.

This remains a bearer capability: whoever obtains an unused claim capability can authorize a destination of their choosing. It is not identity-bound recipient verification. The critical safety property is destination binding, not theft resistance of the link.

## Exact typed-data scheme

- EIP-712 domain name: `Reach Payout Vault`
- EIP-712 domain version: `1`
- Domain binding: the standard domain includes `chainId` and `verifyingContract`
- Primary type: `Claim`
- Type string: `Claim(uint256 payoutId,address recipient,bytes32 action,uint256 version)`
- `action`: `keccak256("ReachPayoutVault.claim")`
- `version`: `1`
- Contract verifier: OpenZeppelin Contracts 5.6.1 `EIP712` and `ECDSA`

OpenZeppelin's maintained ECDSA implementation rejects invalid and high-`s` signatures. The vault uses checks-effects-interactions and OpenZeppelin `ReentrancyGuard`; no backend signing key exists.

## State and accounting

`NONE -> FUNDED -> CLAIMED` or `NONE -> FUNDED -> RECLAIMED`.

- Claim succeeds only when `block.timestamp < expiresAt`.
- Reclaim succeeds only when `block.timestamp >= expiresAt` and `msg.sender == sender`.
- A payout ID is unique and cannot be reused.
- The token is immutable per deployment; v1 deploys one verified TIP-20 address rather than accepting arbitrary tokens.
- Funding calls `transferFromWithMemo(sender, vault, amount, bytes32(payoutId))` in the same transaction as record creation.
- Claim and reclaim call `transferWithMemo(destination, amount, bytes32(payoutId))`.
- A false token return or revert rolls back state and accounting.
- No owner, admin, rescue, pause, or upgrade path exists in this v1 contract.

## Required adversarial evidence

`test/ReachPayoutVault.ts` contains 25 passing tests. The security-critical test names include:

- `enforces that the signed recipient cannot be changed`
- `proves a copied exact authorization cannot redirect funds`
- `allows exactly one winner when two claim attempts race`
- `rejects a signature for payout A when presented for payout B`
- `rejects a signature bound to contract A when used on contract B`
- `rejects a signature from the wrong EIP-712 chain domain`
- `rejects claim at and after expiry`
- `does not leave a false terminal state when token transfer returns false`
- `keeps live vault balance equal to the sum of FUNDED payouts`
- `never places the raw claim private key in claim calldata`

Commands:

```text
hardhat build
hardhat test
tsc --noEmit
```

Observed local result on 2026-09-21: `25 passing (25 nodejs)`; TypeScript compiler exited successfully.

## Moderato integration harness

`scripts/integration-moderato.ts` uses current Moderato `pathUSD` by default (`0x20c0000000000000000000000000000000000000`) and the official TIP-20 memo entrypoints. It requests faucet funding for an in-memory disposable deployer when no `TEMPO_DEPLOYER_PRIVATE_KEY` is supplied; a supplied key is never written to evidence. It records token metadata, deployment/create/fund/claim/reclaim hashes, balances, payout records, and memo events without recording a claim private key.

The harness proves contract + live token integration only. It does not claim passkey onboarding, fee sponsorship, browser UX, API completeness, batch support, or release readiness.

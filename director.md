# Reach Director State

Last updated: 2026-09-21
Current status: BUILDING
Current phase: PHASE 1 — payout vault core and safe claim authorization
Phase 1 status: INTEGRATION PROVEN — payout vault on Tempo testnet
Submission status: NOT READY

This is a factual handoff. Nothing is called shipped unless it is exercised against the real system and the evidence is recorded.

## Product promise

Reach lets a sender pay a person before that person has a blockchain wallet address. The sender creates and funds a stablecoin payout, shares a secure bearer claim capability, and the recipient creates or uses a supported Tempo account to claim the money. Reach reports `CLAIMED` only after authoritative onchain state confirms the transfer.

Tagline: Pay people, not wallet addresses.

## Current architecture

Reach uses a small non-upgradeable `ReachPayoutVault` on Tempo plus offchain metadata and reconciliation that never owns pooled payout funds.

- The vault has one immutable supported TIP-20 token per deployment.
- Each payout fixes `sender`, integer `amount`, `expiresAt`, one-time `claimSigner`, `status`, and optional `claimant`.
- `createPayout` pulls the exact amount in the same transaction as creating the `FUNDED` record.
- `claim` accepts a one-time EIP-712 authorization and sends only to the signed recipient.
- `reclaim` is sender-only and available only when `block.timestamp >= expiresAt`.
- The backend may store labels, reasons, idempotency records, chain cursors, and derived status. It does not hold payout funds or sender signing keys.
- The web app, Tempo account/passkey onboarding, fee sponsorship, API, batch flow, and MPP remain separate gates.

## Current claim authorization decision

The earlier raw bearer-secret-in-calldata model is rejected and is not current architecture. A `keccak256(secret)` plus `claim(secret)` call would expose the secret in the public transaction and allow an observer to copy it into a competing transaction. It also cannot safely bind an alternate destination.

The current one-time claim-signer model is:

1. The client generates a cryptographically secure one-time secp256k1 private key and derives `claimSigner`.
2. The onchain payout stores only `claimSigner`; the private key is never stored onchain, sent as calldata, emitted, logged, put in analytics, or committed to Git.
3. The private capability is carried in a URL fragment or equivalent bearer representation.
4. The client signs `Claim(payoutId, recipient, action, version)` using EIP-712.
5. `claim(payoutId, recipient, signature)` recovers the signer and requires it to equal the stored `claimSigner`.
6. The contract transfers to the signed `recipient`, not to an attacker-controlled argument or necessarily to `msg.sender`. This permits a relayer while preserving destination binding.

The link remains a bearer capability. Anyone who obtains an unused capability can authorize themselves, so Reach must not describe the link as identity-bound. A copied exact transaction can land first, but it can only pay the signed recipient; changing the recipient makes the call revert.

Exact domain and type:

- domain name `Reach Payout Vault`
- domain version `1`
- standard EIP-712 `chainId` and `verifyingContract` domain binding
- type `Claim(uint256 payoutId,address recipient,bytes32 action,uint256 version)`
- `action = keccak256("ReachPayoutVault.claim")`
- `version = 1`

The preferred browser/API boundary is client-side key generation. If a future API must generate or retain a capability for idempotent retry, that is an explicit encrypted-at-rest trust boundary; the backend still never signs claims or holds payout funds.

## Toolchain and source decisions

- Solidity `0.8.34` compiled with Hardhat `3.17.0`.
- `@nomicfoundation/hardhat-toolbox-viem` `5.0.7` and Viem `2.56.8`.
- OpenZeppelin Contracts `5.6.1` for EIP-712, ECDSA, and reentrancy protection.
- Tempo Testnet (Moderato), chain ID `42431`, RPC `https://rpc.moderato.tempo.xyz`.
- Default payout token: official live Moderato pathUSD at `0x20c0000000000000000000000000000000000000`, observed metadata `PathUSD`, 6 decimals.
- Forge is not installed; Hardhat is retained because official Tempo materials support both Hardhat and Foundry and this EVM contract path does not need a Tempo-specific fork.

The current TIP-20 source was checked against Tempo Standard Library: `approve`, `transferFrom`, `transferFromWithMemo`, `transferWithMemo`, and `permit` are part of the published interface. The live pathUSD memo transfer returned empty data despite the interface declaring `bool`; the vault now uses a narrow low-level wrapper that accepts empty successful return data or explicit `true`, and rejects revert/explicit `false`. This discrepancy is recorded in `docs/live-discrepancy.md`.

## Local proof

`test/ReachPayoutVault.ts` has 25 passing Node tests. It covers:

- exact create/fund, insufficient allowance, insufficient balance, ID reuse, zero amount, invalid signer
- valid claim, exact recipient amount, wrong key, payout binding, contract binding, chain-domain binding
- signed recipient immutability and copied exact authorization redirection safety
- duplicate claim, before/at/after expiry, sender-only reclaim, reclaim/claim terminal-state exclusions
- two concurrent claim attempts with exactly one winner
- transfer-failure rollback and vault/token accounting equality
- raw claim private key absent from claim calldata

Observed commands and results on 2026-09-21:

```text
hardhat test     -> 25 passing (25 nodejs)
tsc --noEmit     -> success
hardhat build    -> success with solc 0.8.34
```

## Live Moderato proof

Fresh corrected deployment evidence is in `docs/moderato-live-evidence.md` and the ignored raw JSON artifact `deployments/moderato-integration-1789978031428.json`.

- corrected vault: `0x98262c02746f3b91342249159deeebe87a54266c`
- deployment tx: `0xa04337394a23594599f8d4c1246b70dcfb0e2cbd0689532cee2e4eb743d64681`
- create/fund tx: `0x14db360bbe4d870833805ba0e15391ecf2c574ca7444f75ead0e14a149ac9c62`
- claim tx: `0x56bcbc992dce52c8f4538f1665f59839b05d1c1101c703e921ff69a2e46260e6`
- reclaim tx: `0xba309c7dadf8c1dd798ceeb9dc00ddffd351dcc11e71ea7cfe0b78538a9cb82f`
- recipient balance increased from `1,000,000,000,000` to `1,000,001,000,000` pathUSD base units
- claimed payout storage is `status = CLAIMED` and claimant is the recipient
- expired second payout storage is `status = RECLAIMED`
- pathUSD `TransferWithMemo` events show payout-ID memos on funding, claim, and reclaim

The first disposable deployment used before the compatibility fix is not counted as proof. Its claim reverted with valid EIP-712 signer recovery because live `transferWithMemo` returned empty data to the old high-level ABI; its payout remained `FUNDED` with 1,000,000 units in the vault. No user funds were involved. See `docs/live-discrepancy.md`.

## What is genuinely working

- Reach repository and Phase 1 contract workspace exist under `C:\Users\HomePC\Desktop\Reach`.
- The contract compiles, local adversarial tests pass, and TypeScript validation passes.
- A corrected vault was deployed to Moderato.
- Live verified pathUSD funding, signed claim, recipient balance change, authoritative `CLAIMED` state, expiry, sender reclaim, and memo events were observed.

## What remains unproven or disabled

- Tempo passkey/WebAuthn account creation from a cold claim link.
- Sponsored-fee claim through the intended actual browser account flow.
- Backend metadata, idempotency, event replay, unknown-receipt recovery, and direct-vault/database reconciliation.
- Consumer UI, business batch UI, developer API, MPP, marketing site, and release deployment.
- Mainnet token configuration and any mainnet transaction.

## Kill-gate summary

- Gates 1–3: PASS for the vault core; evidence is local plus live testnet integration.
- Gates 4–6: HOLD pending browser account/passkey, sponsored-fee, and reconciliation proof.
- Gate 7: KILL FOR V1; recipient-selected settlement remains removed.
- Gate 8: DEFERRED; MPP is not in the build.

## Next exact task

Build only a tiny consumer harness against the corrected vault: claim-link fragment parsing with redaction, account/passkey onboarding experiment, and an explicitly sponsored claim experiment. Do not expand into the broad web app until Gates 4–6 have evidence.

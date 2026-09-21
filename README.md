# Reach

Pay people, not wallet addresses.

Reach is BUILDING. Phase 1 is complete for the narrow money-path objective: the non-upgradeable payout vault has 25 passing adversarial local tests and a fresh live Tempo Moderato create/fund/claim/reclaim integration.

## What is proven

- EIP-712 one-time claim-signer authorization; raw private keys never enter calldata.
- Destination binding: a valid Alice signature cannot be changed to Attacker, and a copied exact transaction still pays Alice.
- Atomic exact funding, duplicate-claim prevention, deterministic expiry/reclaim boundary, sender-only reclaim, and exact accounting.
- Live Moderato pathUSD integration with memo events.

## What is not claimed

Passkey/WebAuthn onboarding, sponsored fees, backend reconciliation, consumer UI, business batches, developer API, MPP, mainnet, and release readiness remain unproven. See [director.md](director.md), [docs/kill-gates.md](docs/kill-gates.md), and [docs/phase1-contract.md](docs/phase1-contract.md).

## Reproduce the contract proof

```text
hardhat build
hardhat test
tsc --noEmit
```

The default live target is Tempo Testnet (Moderato), chain ID `42431`, with pathUSD at `0x20c0000000000000000000000000000000000000`. Live scripts use disposable in-memory keys when no deployer key is supplied and never write private keys to evidence. See `scripts/integration-moderato.ts` for the controlled harness.

# Reach Director State

Last updated: 2026-09-21
Current status: BUILDING
Current phase: PHASE 0, understand, verify, and design the smallest safe real architecture

This is a factual handoff, not a product plan. Items below are marked as verified, inferred, hypothesized, or blocked. No item is called shipped until it is exercised against the real system.

## Product promise

Reach lets a sender pay a person before that person has a blockchain wallet address. The sender creates and funds a stablecoin payout, shares a secure claim link, and the recipient creates or uses a supported Tempo passkey account to claim the money. The system reports claimed only after authoritative onchain state confirms the settlement.

Tagline: Pay people, not wallet addresses.

## Intended users

- Individual sender creating one payout.
- Business or operator creating many payouts.
- Recipient claiming a payout from a mobile-friendly link.
- Developer integrating payout creation and inspection through an API.
- Optional machine or MPP payer, only if idempotent mapping to one payout is proven.

## Locked scope

- One real payout engine.
- Consumer single-payout flow.
- Business batch flow after the single-payout path is proven.
- Developer API for creating and inspecting payouts without recipient wallet addresses.
- Recipient claim flow with supported Tempo account or passkey onboarding.
- Real stablecoin funding, claim, authoritative claimed state, expiry, and reclaim.
- Testnet-first deployment and adversarial financial-invariant testing.
- MPP is conditional and feeds the same payout engine if it passes its kill gate.

## Explicitly rejected scope

- Generic payment links, generic payroll, invoicing, a wallet, a stablecoin DEX, cross-chain transfers, fiat offramps, bridges, NFTs, tokens, tax software, KYC, loyalty, yield, unnecessary AI, and custom messaging infrastructure.
- Recipient-selected settlement stablecoin in v1. Current official Tempo material describes on-chain FX and non-USD stablecoin support for direct on-chain liquidity as coming soon, not as a verified Reach path.
- MPP as a parallel product or as a reason to add unsafe operator custody.

## Current user journey

1. Sender opens Reach and creates a payout with amount, token, recipient label, reason, and expiry.
2. Reach prepares a funding transaction. The sender signs the funding action from their account.
3. The payout vault holds the exact token amount under a one-time claim commitment.
4. Reach returns a claim URL. The sender shares it through a channel of their choice.
5. Recipient opens the link and sees the amount and reason before any infrastructure language.
6. Recipient creates or uses a supported Tempo passkey account.
7. Reach submits a claim transaction with the one-time secret. The intended claim flow is sponsored where Tempo support is proven.
8. The vault marks the payout claimed and transfers the exact amount to the recipient account atomically.
9. Sender and business views update from reconciled onchain state, not optimistic UI state.

## Current architecture

Architecture candidate selected for Phase 0: a non-upgradeable dedicated payout vault contract on Tempo plus an offchain metadata and reconciliation service.

- Onchain vault: owns funded payout balances, checks claim commitments, enforces one-way state transitions, transfers the exact token amount, emits payout lifecycle events, and permits expiry reclaim only after the expiry boundary.
- Web client: human sender and recipient flows, claim-link handling, account/passkey connector, and direct user-signed transactions where appropriate.
- Backend: private metadata, idempotency keys, encrypted API claim secret storage where an API client needs deterministic retries, chain event reconciliation, and developer/API endpoints. The backend does not hold pooled payout funds or sender signing keys.
- Database: derived index and metadata cache. It is not the authority for funded, claimed, or reclaimed state.
- Tempo primitives: TIP-20 stablecoin transfers and memos where proven useful, native Tempo transaction batching for atomic approval plus funding and future batch creation, passkey account flow, fee sponsorship, and optionally MPP.

## Source-of-truth links

### Hackathon

- [Crypto World’s Fair official page](https://colosseum.com/worldsfair)
- [Colosseum hackathon FAQ](https://colosseum.com/hackathon)
- [Crypto World’s Fair official rules PDF](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)

### Tempo

- [Tempo official documentation](https://docs.tempo.xyz/)
- [Tempo official protocol repository](https://github.com/tempoxyz/tempo)
- [Viem Tempo Mainnet chain definition](https://github.com/wevm/viem/blob/main/src/chains/definitions/tempo.ts)
- [Viem Tempo Moderato chain definition](https://github.com/wevm/viem/blob/main/src/chains/definitions/tempoModerato.ts)
- [Tempo sponsored user fees](https://docs.tempo.xyz/guide/payments/sponsor-user-fees)
- [Tempo batch transactions](https://docs.tempo.xyz/guide/use-accounts/batch-transactions)
- [Tempo transfer memos](https://docs.tempo.xyz/guide/payments/transfer-memos)
- [Tempo Accounts SDK](https://github.com/tempoxyz/accounts)
- [MPP TypeScript SDK](https://github.com/wevm/mppx)
- [MPP documentation](https://mpp.dev/sdk/typescript)

## Official hackathon requirements

Verified from the official page and rules on 2026-09-21:

- Contest period: September 14, 2026 at 6:00am PT through October 12, 2026 at 11:59pm PT.
- Tempo track: $100,000 shared across 10 products integrating with Tempo.
- Submission: one project submission per team; each member registers; the team leader uploads the project.
- Submission material: product name and description, integrated blockchains and tools, teammates and backgrounds, team location, logo or graphic, repository link, a 2 to 3 minute presentation video, a product demo video of no more than 3 minutes, go-to-market, demand validation, and distribution plans.
- Rules judging criteria: Functionality, Potential Impact, Novelty, UX, Open-source, and Business Plan. Official FAQ also describes founder and market fit, insight, product and execution, market size, communication, viability, and traction as review factors. We have not found published numeric weights.
- Open source is a judging criterion and open repositories are encouraged. A private repository is allowed if review access is granted to hackathon@colosseum.com.
- No official requirement found that a project must be deployed live or use Mainnet. Reach will still deploy and test on Tempo Moderato first.

## Official Tempo assumptions verified

- Moderato RPC responds to `eth_chainId` with `0xa5bf`, decimal 42431, and `eth_blockNumber` on 2026-09-21.
- Mainnet RPC responds to `eth_chainId` with `0x1079`, decimal 4217, and `eth_blockNumber` on 2026-09-21.
- Official current Viem chain definitions list `https://rpc.moderato.tempo.xyz`, `https://rpc.tempo.xyz`, the corresponding WebSocket URLs, and the Tempo explorers.
- Tempo is EVM compatible and the official repository says Solidity, Foundry, and Hardhat are supported.
- Official docs describe TIP-20 stablecoins, 6-decimal examples, indexed 32-byte transfer memos, native atomic batching, fee sponsorship, and WebAuthn-oriented accounts.
- Official docs provide a public Moderato fee payer endpoint and a `withFeePayer` transport path.
- The documented testnet addresses for pathUSD, AlphaUSD, and BetaUSD answer metadata calls on Moderato with 6 decimals. AlphaUSD and BetaUSD are named in the official examples. The example AlphaUSD and BetaUSD addresses are not initialized on Mainnet; Mainnet payout token configuration is therefore not selected.
- Official MPP/`mppx` docs show Tempo charge and session flows, canonical escrow defaults, and HTTP 402 handling. They do not prove that an MPP payment can safely become exactly one Reach payout without an idempotent settlement design.

## Unverified assumptions / kill gates

- The full browser claim path with a new Tempo WebAuthn account has not been run from Reach.
- Sponsored claim of the payout-vault contract call has not been proven end to end.
- The deployed contract and test suite do not yet exist.
- Actual batch payload size limits for mass payouts are not yet measured.
- Mainnet stablecoin selection and liquidity are not yet proven and are disabled for v1.
- MPP mapping, duplicate prevention, and recovery are not yet proven and are deferred.

## Current package/tool versions

### Environment observed on Windows PowerShell

- OS: Windows NT 10.0.22621.0.
- PowerShell: 7.6.5.
- Git: 2.53.0.windows.2.
- Node: v24.14.0.
- npm: 11.9.0.
- pnpm: 11.19.0.
- Python: 3.14.3.
- Rust: 1.95.0.
- Cargo: 1.95.0.
- Docker: 29.7.2.
- Foundry `forge`: not installed.

### Selected application stack for implementation after Phase 0

- Next.js 16.3.5 and React 19.3.0 for the web product and API route surface.
- TypeScript 7.0.2 for application code.
- Viem 2.56.8 for chain interaction and current Tempo chain support.
- Wagmi 3.7.7 for React account and connector state, using the maintained Tempo exports rather than the archived `tempo.ts` repository.
- Tempo Accounts SDK `accounts` 0.18.4 for supported account and passkey integration where its current API is the right fit.
- Solidity with Hardhat for the first contract test/deploy path because Foundry is not installed on this machine and Tempo states both are supported. The exact Hardhat version will be pinned when the contract workspace is created and smoke-tested.
- Postgres through a small server-side data layer for metadata, idempotency, and reconciliation. The ORM/provider is not yet selected.
- `mppx` 0.10.1 is deferred and will not be added until the MPP kill gate passes.

Package versions were read from the npm registry on 2026-09-21. No package has been installed in Reach yet.

## Environment/network configuration

- Primary development network: Tempo Testnet (Moderato), chain ID 42431.
- Moderato RPC: `https://rpc.moderato.tempo.xyz`.
- Moderato WebSocket: `wss://rpc.moderato.tempo.xyz`.
- Moderato explorer: `https://explore.testnet.tempo.xyz` from the current Viem chain definition.
- Moderato public fee payer: `https://sponsor.moderato.tempo.xyz`.
- Tempo key manager host: `https://keys.tempo.xyz`.
- Mainnet is not an active deployment target yet.
- Planned environment variable names only: `NEXT_PUBLIC_TEMPO_RPC_URL`, `NEXT_PUBLIC_TEMPO_CHAIN_ID`, `NEXT_PUBLIC_TEMPO_EXPLORER_URL`, `NEXT_PUBLIC_PAYOUT_VAULT_ADDRESS`, `DATABASE_URL`, `CLAIM_SECRET_ENCRYPTION_KEY`, `FEE_PAYER_URL`, `TEMPO_DEPLOYER_PRIVATE_KEY`, `MPP_SECRET_KEY`.
- No secret values have been written to this repository.

## Contract addresses

- Payout vault: not deployed.
- Moderato pathUSD example token: `0x20c0000000000000000000000000000000000000`, live metadata call returned `pathUSD`, 6 decimals.
- Moderato AlphaUSD example token: `0x20c0000000000000000000000000000000000001`, live metadata call returned `AlphaUSD`, 6 decimals.
- Moderato BetaUSD example token: `0x20c0000000000000000000000000000000000002`, live metadata call returned `BetaUSD`, 6 decimals.
- Mainnet addresses for AlphaUSD and BetaUSD examples are not initialized. No Mainnet payout token has been selected.

## API endpoints

No endpoints are implemented. Planned surface after the contract core is proven:

- `POST /v1/payouts` with an idempotency key, amount in integer token units, token address, reason, recipient label, and expiry.
- `GET /v1/payouts/:id` for metadata plus reconciled authoritative status.
- `GET /v1/payouts` for sender or business-scoped list views.
- `POST /v1/payouts/:id/reconcile` for an explicitly safe, read-and-reconcile operation, never a blind transaction retry.
- A future MPP HTTP 402 entrypoint only if it maps one payment challenge and one settlement to one payout record.

## Database/schema state

No database exists yet. Planned minimum records are `payout_intents`, `payouts`, `batch_payouts`, `idempotency_keys`, and `reconciliation_cursors`. Private claim secrets, when required for API idempotent link recreation, will be encrypted at rest. Plaintext secrets must not be logged or placed in URLs outside a fragment.

## Deployment URLs

- Reach application: not deployed.
- Contract: not deployed.
- API: not deployed.

## Current test results

- Repository tests: none yet.
- Contract tests: none yet.
- Browser tests: none yet.
- Live RPC checks: PASS for both chain IDs and block numbers on 2026-09-21.
- Live token metadata checks: PASS for the three Moderato example token addresses; Mainnet example AlphaUSD and BetaUSD addresses returned uninitialized errors.
- Public fee payer and key manager hosts: reachable, but a HEAD request returned 400 and 404 respectively. This proves reachability only, not a successful sponsored transaction or passkey ceremony.

## Security findings

- The core must not use a pooled hot wallet or offchain balance ledger as the payout entitlement.
- A claim URL is a bearer credential. The URL must use a high-entropy one-time secret, must not contain signing keys, and should keep the secret in a URL fragment to reduce Referer leakage.
- The contract must store only a commitment, never the claim secret.
- The contract must update state before the external token transfer and use a non-reentrant guard or equivalent defense.
- Claim and reclaim must both require the same single `FUNDED` state, so a transaction race has one authoritative winner.
- API retries require a unique sender-plus-idempotency-key record and an intent hash. Unknown chain transactions must be reconciled, not blindly resent.
- Token and amount are integer units. No JavaScript floating point is allowed for financial accounting.
- The product cannot honestly call itself fully non-custodial while it depends on the token issuer, passkey/key manager, fee sponsor, RPC, and metadata backend.

## Known bugs

- None known because implementation has not started. Absence of known bugs is not evidence of readiness.

## Recovery behavior

Not implemented. Required behavior: on restart, replay `PayoutCreated`, `PayoutClaimed`, and `PayoutReclaimed` events from the deployment block or a persisted cursor; treat duplicate events as idempotent; query receipts before any retry; surface `UNKNOWN` when chain truth cannot be resolved.

## Decisions made and why

- Dedicated vault over backend custody: the contract can hold each funded entitlement and enforce one successful claim or reclaim without trusting an operator’s accounting database.
- Non-upgradeable v1 contract: reduces administrator powers and makes the money path auditable. Any future upgrade path requires a new explicit design review.
- Testnet first: live RPC and token behavior are verified, but the claimant and sponsored-fee browser path is not.
- Recipient-selected settlement removed from v1: official Tempo sources describe direct onchain FX and non-USD stablecoin support as coming soon, while fee AMM material concerns fee conversion, not payout settlement.
- MPP deferred: the official SDK is available, but the exact one-payment-to-one-payout authorization and recovery invariant is not yet proven.
- No broad UI before the contract and kill gates: the build process skill requires the risky core to be proven first.

## Current phase

PHASE 0, BUILDING. Research and architecture artifacts are being created. Phase 0 is not marked complete until the core model is tested and no unresolved assumption makes create to fund to claim structurally impossible.

## What is genuinely working

- The requested folder exists at `C:\Users\HomePC\Desktop\Reach`.
- Git repository initialized on branch `main`.
- Required local skills were located and read from the Desktop skill folder.
- Official hackathon rules and current Tempo documentation were inspected.
- Live Tempo Moderato and Mainnet RPC endpoints respond with the expected chain IDs.
- Live Moderato token metadata matches the documented example names and 6-decimal units.

## What is only component-proven

- Official Tempo documentation and current upstream chain definitions prove that the primitives exist in the ecosystem.
- A live JSON-RPC read proves endpoint and metadata reachability only.
- The proposed vault state machine is a design, not a deployed or audited contract.

## What is still mocked

- Nothing has been mocked in the product because no product implementation exists yet.

## What is disabled

- Mainnet funding and claims.
- Recipient-selected settlement stablecoin.
- MPP entrypoint.
- Any claim of completed passkey onboarding or sponsored claim.

## What requires human action

- Confirm the actual competition account, team members, location, and submission credentials.
- Provide or create a disposable Moderato development account and obtain test funds when implementation begins. Do not use a wallet containing real value.
- Decide the production database provider and deployment account after the contract smoke test.
- Review any request to use a real Mainnet wallet or funds.

## Next exact task

Create the smallest Hardhat contract workspace for a non-upgradeable payout vault, compile it, write tests for create, fund, claim, duplicate claim, wrong secret, expiry, reclaim, and claim/reclaim races, then deploy a controlled testnet instance only after local tests pass.

## Blockers

- Passkey onboarding and sponsored claim are not yet proven in the actual browser flow.
- Foundry is missing; Hardhat version and Tempo-specific deployment behavior still need a smoke test.
- Mainnet token configuration is unresolved.
- The current product brief says four days, while the official hackathon runs four weeks. The build plan is following the stricter four-day engineering constraint supplied by the director.

## Submission status

NOT READY. No application, contract, deployment, demo, or submission exists yet. The repository is at Phase 0 research and architecture.


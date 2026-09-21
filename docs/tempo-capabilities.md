# Tempo Capabilities for Reach

Research date: 2026-09-21

Status vocabulary: VERIFIED means documented and checked against a live read where practical. PARTIALLY VERIFIED means the primitive is documented or component-tested but the exact Reach flow is not yet proven. NOT SUITABLE means it is not safe to include in v1.

## Networks and RPC

| Capability | Status | Source | How Reach would use it |
|---|---|---|---|
| Tempo Mainnet | VERIFIED | Current Viem chain definition and live RPC read | Hold for a later controlled release after safety gates and token configuration pass |
| Tempo Moderato testnet | VERIFIED | Current Viem chain definition and live RPC read | Build, test, and run the first end-to-end payout journey |
| Moderato chain ID 42431 | VERIFIED | `tempoModerato` chain definition and `eth_chainId` returned `0xa5bf` | Reject wrong-network funding and claim attempts |
| Mainnet chain ID 4217 | VERIFIED | `tempo` chain definition and `eth_chainId` returned `0x1079` | Keep Mainnet configuration explicit and disabled until release gates pass |
| Moderato RPC | VERIFIED | `https://rpc.moderato.tempo.xyz` | Public client transport for testnet |
| Mainnet RPC | VERIFIED | `https://rpc.tempo.xyz` | Future controlled release transport |
| Moderato WebSocket | VERIFIED | Current Viem chain definition | Optional event watch transport |
| Mainnet WebSocket | VERIFIED | Current Viem chain definition | Future controlled release transport |

## Tooling

| Capability | Status | Source | How Reach would use it |
|---|---|---|---|
| Viem Tempo chain support | VERIFIED | `wevm/viem` current chain definitions | Read chain state, encode calls, wait for receipts, and use TIP-20 helpers |
| Wagmi Tempo exports | VERIFIED | Tempo docs and maintained Wagmi releases | React account/connector state and Tempo-specific hooks |
| `accounts` SDK | VERIFIED | `tempoxyz/accounts` official repository | Integrate Tempo Wallet, WebAuthn, fee payer, and account flows where required |
| Solidity smart contracts | VERIFIED | `tempoxyz/tempo` official README | Implement the payout vault with EVM tooling |
| Hardhat or Foundry deployment | VERIFIED | `tempoxyz/tempo` official README | Compile, test, deploy, and verify the vault; Hardhat is selected first because Forge is absent |
| Archived `tempo.ts` package | NOT SUITABLE | `tempoxyz/tempo-ts` repository says archived and directs new integrations to maintained packages | Do not add archived `tempo.ts` dependencies |

## Accounts and passkeys

| Capability | Status | Source | How Reach would use it |
|---|---|---|---|
| Tempo smart-account transaction model | VERIFIED | Tempo official repository | Let the recipient account authorize a claim without a conventional wallet address at sender creation time |
| WebAuthn / passkey connector | PARTIALLY VERIFIED | Tempo sponsored-fee guide shows `webAuthn` with `KeyManager.http('https://keys.tempo.xyz')` | Create or use recipient account in the claim flow; must pass a real browser ceremony before being called working |
| Cross-device passkey behavior | PARTIALLY VERIFIED | Tempo protocol/repository descriptions | Treat as supported only after browser UAT on target devices |
| Claim account can sign vault call | UNKNOWN | No Reach browser integration exists yet | Implement and run the claim-vault call before passing Kill Gate 4 |

## Fees and transactions

| Capability | Status | Source | How Reach would use it |
|---|---|---|---|
| Fee sponsorship | PARTIALLY VERIFIED | [Sponsor User Fees](https://docs.tempo.xyz/guide/payments/sponsor-user-fees) | Sponsor the recipient’s claim transaction so the recipient does not supply gas, after end-to-end proof |
| Public Moderato fee payer | PARTIALLY VERIFIED | Official guide lists `https://sponsor.moderato.tempo.xyz`; host was reachable and returned HTTP 400 to HEAD | Configure the testnet transport and verify an actual claim transaction |
| Transaction-specific fee payer signatures | VERIFIED | Official guide security notes | Keep sponsorship bounded to the exact claim transaction |
| Native transaction batching | VERIFIED | [Batch Transactions](https://docs.tempo.xyz/guide/use-accounts/batch-transactions) | Atomically combine token approval and payout creation; later batch safe payout creation if limits are measured |
| Batch size for Reach mass payouts | UNKNOWN | Not established in current research | Measure before promising large imports or choose explicit chunking |

## Stablecoins and reconciliation

| Capability | Status | Source | How Reach would use it |
|---|---|---|---|
| TIP-20 stablecoin standard | VERIFIED | Tempo official repository and docs | Restrict v1 to supported TIP-20 stablecoins with integer units |
| Moderato pathUSD | VERIFIED | Live metadata call to `0x20c0000000000000000000000000000000000000` | Use only if funding and faucet path are proven for the selected demo |
| Moderato AlphaUSD | VERIFIED | Official examples and live metadata at `0x20c0000000000000000000000000000000000001` | Default testnet demo token candidate, 6 decimals |
| Moderato BetaUSD | VERIFIED | Official examples and live metadata at `0x20c0000000000000000000000000000000000002` | Secondary testnet token candidate, 6 decimals |
| Mainnet AlphaUSD/BetaUSD example addresses | NOT SUITABLE | Live metadata calls returned uninitialized errors | Do not use those example addresses on Mainnet |
| Transfer memos | VERIFIED | [Transfer Memos](https://docs.tempo.xyz/guide/payments/transfer-memos) | Link short payout references to onchain transfers where the contract path supports it |
| Indexed `bytes32` memo | VERIFIED | Official TIP-20 guide | Reconcile deposits or payout references without putting private PII onchain |
| Exact token decimals | VERIFIED for tested Moderato examples | Live `decimals()` calls returned 6 | Use `bigint` integer units and reject floating point accounting |

## Stablecoin exchange and recipient choice

| Capability | Status | Source | How Reach would use it |
|---|---|---|---|
| Tempo Fee AMM | VERIFIED for fee conversion | [Managing Fee Liquidity](https://docs.tempo.xyz/guide/stablecoin-dex/managing-fee-liquidity) | Treat as a fee-payment primitive only |
| Recipient chooses a different payout settlement stablecoin | NOT SUITABLE for v1 | Tempo’s current official repository describes on-chain FX and non-USD stablecoin support for direct onchain liquidity as coming soon | Remove this feature from v1 rather than simulate it |

## MPP

| Capability | Status | Source | How Reach would use it |
|---|---|---|---|
| MPP charge and session SDK | VERIFIED | `wevm/mppx` official repository and `mpp.dev` | Potential API or machine payer entrypoint into the same payout engine |
| Tempo MPP payment | PARTIALLY VERIFIED | Official SDK examples show Tempo payment methods and HTTP 402 handling | Prove one challenge, one payment, one payout record, and safe retry before enabling |
| Custom escrow trust | PARTIALLY VERIFIED | `mppx` docs say canonical escrow is default and custom escrow requires explicit opt-in | Do not use custom escrow in Reach without a separate trust review |
| One MPP payment to one Reach payout | UNKNOWN | No Reach mapping exists | Defer MPP until idempotency, replay, and reconciliation tests pass |

## Deployment and test assets

| Capability | Status | Source | How Reach would use it |
|---|---|---|---|
| Tempo localnet container | VERIFIED | Tempo official README | Optional local contract integration and recovery testing |
| Public Moderato faucet/funding RPC | PARTIALLY VERIFIED | Tempo official README documents `tempo_fundAddress`; no Reach account has requested funds yet | Fund a disposable dev account and contract test harness |
| Block explorer | VERIFIED | Current Viem chain definitions | Secondary evidence link for confirmed transactions |
| Production token and liquidity configuration | UNKNOWN | Mainnet example tokens are not initialized | Block Mainnet release until explicitly selected and checked |

## Official sources

- https://docs.tempo.xyz/
- https://github.com/tempoxyz/tempo
- https://github.com/wevm/viem/blob/main/src/chains/definitions/tempo.ts
- https://github.com/wevm/viem/blob/main/src/chains/definitions/tempoModerato.ts
- https://github.com/tempoxyz/accounts
- https://github.com/wevm/mppx


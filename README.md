# Reach

Pay people, not wallet addresses.

Reach is currently in Phase 0: research and architecture. The project folder, Git repository, official hackathon research, Tempo capability research, custody decision, and financial kill gates are recorded in [director.md](director.md) and [docs/](docs/).

No contract, application, deployment, or demo is claimed yet.

## Current status

BUILDING. The next exact task is to prove the payout vault state machine locally before building the broad interface.

## Reproducibility

- Runtime: Node 24.14.0, pnpm 11.19.0, PowerShell 7.6.5.
- Network target: Tempo Testnet (Moderato), chain ID 42431.
- RPC: `https://rpc.moderato.tempo.xyz`.
- Environment names are listed in [.env.example](.env.example). No secret values belong in Git.

## Proof boundary

The only live checks completed so far are read-only RPC checks for Tempo chain IDs, block numbers, and Moderato token metadata. Contract tests, browser tests, sponsored claims, deployments, and end-to-end payouts remain future work.


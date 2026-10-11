# Moderato live evidence — 2026-09-21

This is the human-readable summary of the authoritative JSON artifact `deployments/moderato-integration-1789978031428.json` (ignored from Git because deployment artifacts are environment-specific). Network: Tempo Testnet (Moderato), chain ID `42431`, RPC `https://rpc.moderato.tempo.xyz`.

## Token and vault

- Token: pathUSD / PathUSD, 6 decimals, `0x20c0000000000000000000000000000000000000`.
- Corrected vault: `0x98262c02746f3b91342249159deeebe87a54266c`.
- Deployment transaction: `0xa04337394a23594599f8d4c1246b70dcfb0e2cbd0689532cee2e4eb743d64681`.
- Disposable deployer: `0xaB5F4574Df1c5389D1157B3fed7BDDac4C3C5a21`.

## Claim path

- Payout ID: `1789978000441`.
- Amount: `1,000,000` pathUSD base units.
- Create/fund transaction: `0x14db360bbe4d870833805ba0e15391ecf2c574ca7444f75ead0e14a149ac9c62`.
- Vault balance after funding: `1,000,000`.
- Recipient: `0xBAB3C4912D0F83DFBf598E9b5d52C8efFB3D7548`.
- Recipient balance before: `1,000,000,000,000`.
- Recipient balance after: `1,000,001,000,000`.
- Claim transaction: `0x56bcbc992dce52c8f4538f1665f59839b05d1c1101c703e921ff69a2e46260e6`.
- `getPayout` after claim: `status = 2 (CLAIMED)`, claimant equals the recipient, amount `1,000,000`.

## Expiry/reclaim path

- Second payout ID: `1789978000442`.
- Create transaction: `0x2e833e8d3a8e22ccaf7622234040ab8bd0f6741589335f0d8c34d788865d890fb`.
- Reclaim transaction after expiry: `0xba309c7dadf8c1dd798ceeb9dc00ddffd351dcc11e71ea7cfe0b78538a9cb82f`.
- `getPayout` after reclaim: `status = 3 (RECLAIMED)`, claimant is zero, amount `1,000,000`.

## Memo evidence

The raw artifact contains four live `TransferWithMemo` events for the create/fund, claim, second create, and reclaim operations. The memo values are the corresponding payout IDs encoded as `bytes32`; the event addresses and from/to values show the vault as the intermediary for claim and reclaim.

## Boundary of proof

This proves the contract and current live pathUSD token integration only. It does not prove passkey account creation, fee sponsorship, browser flow, backend reconciliation, consumer UI, API, batch support, mainnet, or release readiness.

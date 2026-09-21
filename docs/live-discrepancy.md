# Moderato live discrepancy — 2026-09-21

The first disposable live integration deployed vault `0xd97ddc1805c7153e96f543dfdfac05edb693c045` and created payout `1789977717456` for 1,000,000 pathUSD units. The claim transaction reverted, so no claim was reported as successful.

Read-only diagnostics proved:

- chain ID: `42431`
- stored claim signer: `0x6AA9c56cc6B91711FfD095c564717c055Cf4926b`
- recovered signer from the submitted EIP-712 signature: the exact same address
- payout status after revert: `FUNDED`
- vault pathUSD balance after revert: `1,000,000`
- stored `vault` token address: `0x20C0000000000000000000000000000000000000`
- direct read-only `transferWithMemo` simulation from the vault returned empty data instead of the ABI-declared boolean

The failure was therefore the high-level Solidity ABI decoder, not an authorization mismatch or a loss of vault state. The first testnet payout is intentionally not counted as integration proof; its disposable claim key was held only in memory and is no longer available, so that testnet amount remains an unclaimed FUNDED record until the network instance is reset or expires for a sender with the original key. No user funds were involved.

The contract now uses a narrow low-level TIP-20 call wrapper. It accepts an empty successful return or an explicit `true`, and rejects a revert or explicit `false`; checks-effects-interactions and `ReentrancyGuard` remain in force. Local tests still pass with a mock that returns `bool`. A fresh Moderato deployment must prove that the live memo transfer completes before integration is marked passed.

# Research Trail

## 2026-09-21, Phase 0, official rules and Tempo capability audit

What was researched: Current official Crypto World’s Fair page, Colosseum FAQ, official rules PDF, Tempo docs, Tempo protocol repository, current Viem chain definitions, Accounts SDK repository, and MPP SDK repository. Live read-only JSON-RPC checks were run against Tempo Moderato and Mainnet.

Strongest discovery: Tempo’s current payment primitives are real and directly relevant, but the custom future-recipient entitlement remains the product’s load-bearing module. Mainnet example AlphaUSD and BetaUSD addresses are not initialized, and direct onchain FX is not ready for the v1 promise.

Fact: Official rules list functionality, impact, novelty, UX, open-source, and business plan criteria, and the Tempo track is $100,000 across 10 products.

Inference: A non-upgradeable vault plus Tempo account, batching, fee, and TIP-20 primitives is the smallest architecture that preserves the core promise without hot-wallet custody.

Hypothesis: A new Tempo passkey account can claim the vault with a sponsored transaction in a mobile browser. This is a kill-gate hypothesis, not a product claim.

Ideas killed: Recipient-selected settlement for v1, because current official docs do not prove the necessary liquidity path. MPP as a core entrypoint, because one-payment-to-one-payout mapping is unproven.

Ideas advanced: Reach’s dedicated vault entitlement architecture.

Ranking change: No idea ranking performed. The product was locked by the director before research.

Uncertainty: Numeric rubric weights, exact browser account ceremony, fee sponsor behavior for the custom contract, mass batch limits, and production token configuration.

Next gate: Write and adversarially test the vault contract locally, then deploy only to a controlled Moderato testnet account after tests pass.


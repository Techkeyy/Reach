# Competition Brief

Competition: Crypto World’s Fair 2026
Organizer: Colosseum Org LLC
Official page: https://colosseum.com/worldsfair
Research date: 2026-09-21
Contest period: September 14, 2026 6:00am PT through October 12, 2026 11:59pm PT

## Actual judging criteria

| Criterion | Weight | Evidence / exact wording | Reach response |
|---|---:|---|---|
| Functionality | UNKNOWN | Rules list “How well does this Project Submission work? What is the quality of the code?” | Prove real funding, claim, reclaim, and recovery |
| Potential Impact | UNKNOWN | Rules ask about market size and broader crypto ecosystem impact | Make walletless stablecoin payouts the narrow wedge |
| Novelty | UNKNOWN | Rules ask how unique the concept is | Distinguish a vault entitlement and recipient onboarding from a generic payment link |
| UX | UNKNOWN | Rules ask how well blockchain creates great downstream UX | Lead with recipient value, mobile claim, and sponsored fees if proven |
| Open-source | UNKNOWN | Rules ask whether the project is open-source and composes with crypto primitives | Prefer public code, tests, source links, and honest limits |
| Business Plan | UNKNOWN | Rules ask about viable future business and execution ability | Define API and business payout wedge |

## Sponsor / ecosystem primitives

Tempo provides EVM execution, TIP-20 stablecoins, transfer memos, native atomic batching, fee sponsorship, WebAuthn-oriented accounts, and MPP tooling. The only load-bearing Reach-specific behavior is the escrow entitlement with one-time claim, expiry, and reclaim, so that part remains custom and is subject to contract review.

## Collision risks

- “Payment link” is broad and crowded. Reach must keep the phrase “payout entitlement before recipient wallet address” central.
- Generic MPP demos are a collision risk. MPP is optional and not the product.
- Native Tempo batching or payment docs are primitives, not the product differentiator.

## Competition-specific rejection checklist

- [ ] Team registration and one-team constraint confirmed by human.
- [ ] Prior code and pre-hackathon work disclosed accurately.
- [ ] Repo link works and contains only truthful claims.
- [ ] Presentation and product demo videos meet current limits.
- [ ] Tempo integration is real and central to the payout path.
- [ ] Any track-specific submission fields are checked before submission.
- [ ] No private keys or secrets are committed.

## Source register

| ID | Source | Type | Accessed | Claims supported | Confidence |
|---|---|---|---|---|---|
| SRC-001 | https://colosseum.com/worldsfair | Official event page | 2026-09-21 | dates, prize pool, track framing, accelerator | High |
| SRC-002 | https://colosseum.com/hackathon | Official FAQ | 2026-09-21 | eligibility, submission fields, judging context, solo/team rules | High |
| SRC-003 | https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf | Official rules PDF | 2026-09-21 | dates, eligibility, judging criteria, restrictions, prizes | High |
| SRC-004 | https://docs.tempo.xyz/ | Official Tempo docs | 2026-09-21 | capability map | High |
| SRC-005 | https://github.com/tempoxyz/tempo | Official Tempo repository | 2026-09-21 | network, EVM, Solidity/Foundry/Hardhat, Tempo primitives | High |
| SRC-006 | https://github.com/wevm/viem/blob/main/src/chains/definitions/tempo.ts | Maintained upstream chain definition | 2026-09-21 | Mainnet chain configuration | High |
| SRC-007 | https://github.com/wevm/viem/blob/main/src/chains/definitions/tempoModerato.ts | Maintained upstream chain definition | 2026-09-21 | Moderato chain configuration | High |
| SRC-008 | https://docs.tempo.xyz/guide/payments/sponsor-user-fees | Official Tempo guide | 2026-09-21 | fee sponsorship and WebAuthn connector path | High |
| SRC-009 | https://docs.tempo.xyz/guide/use-accounts/batch-transactions | Official Tempo guide | 2026-09-21 | native batching semantics | High |
| SRC-010 | https://docs.tempo.xyz/guide/payments/transfer-memos | Official Tempo guide | 2026-09-21 | TIP-20 memos and reconciliation | High |
| SRC-011 | https://github.com/tempoxyz/accounts | Official Accounts SDK | 2026-09-21 | current account integration path | High |
| SRC-012 | https://github.com/wevm/mppx | Maintained MPP SDK | 2026-09-21 | MPP charge/session behavior and custom escrow caveat | High |


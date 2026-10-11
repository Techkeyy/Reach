# Local Skill Application

Research and application date: 2026-09-21

All project work remains in `C:\Users\HomePC\Desktop\Reach`.

## Required local skills found and read

| Skill | Exact path | How it changed Reach Phase 0 |
|---|---|---|
| Audit-skill | `C:\Users\HomePC\Desktop\skill\audit-skill\SKILL.md` | Treats every README or state claim as a test case, separates mechanical hygiene from claims-versus-reality, requires adversarial inputs, and prohibits silent fixes. This produced the truthful status language and explicit proof boundary in `director.md`. |
| build-process | `C:\Users\HomePC\Desktop\skill\build-process\SKILL.md` | Requires mapping the technical pipeline and user journey, identifying the load-bearing module, proving the risky core first, and implementing loading, empty, success, and error states. This is why the next task is the vault state machine instead of broad UI. |
| perfect-readme | `C:\Users\HomePC\Desktop\skill\perfect-readme\SKILL.md` | Requires README claims to come from the running product, a doctor path, offline/demo boundaries, current test counts, and adversarial evidence. The current README is intentionally a Phase 0 stub and does not claim live features. |
| design-skill | `C:\Users\HomePC\Desktop\skill\design-skill\SKILL.md` | Requires product-specific structure, value before infrastructure language, a primary action, four real states, mobile claim UX, readable type, no long dashes in visible UI strings, and rendered QA. It prevents the UI from being built before the financial core is proven. |
| project-understanding | `C:\Users\HomePC\Desktop\skill\project-understanding\SKILL.md` | Requires a plain-language product sentence, actors, user/system journeys, magic moment, onchain/offchain boundary, trust model, one load-bearing assumption, smallest MVP, and non-goals. These are recorded in `docs/product-contract.md` and `docs/architecture-decision.md`. |
| project-edge | `C:\Users\HomePC\Desktop\skill\project-edge\SKILL.md` | Requires rubric evidence, claim audits, differentiation against rivals, adversarial testing, and a product-quality submission pass. Phase 0 records the official rubric and leaves novelty/competitor research as an explicit HOLD rather than inventing a uniqueness claim. |
| hackathon-onboarding | `C:\Users\HomePC\Desktop\skill\hackathon-onboarding\SKILL.md` | Requires official rules before build decisions, conservative environment inspection, secret hygiene, network pinning, a real smoke check, and a PASS/WARN/FAIL doctor. This produced `docs/hackathon-requirements.md`, the network record, `.env.example`, `.gitignore`, and live RPC checks. |
| research-skill | `C:\Users\HomePC\Desktop\research-skill\SKILL.md` | Requires official-source research, Fact/Inference/Hypothesis labels, persistent state, and HOLD instead of guessed evidence. Its competition artifacts live in `work/research/crypto-worlds-fair/`. Idea selection phases were not run because the director supplied Reach as a locked product. |

## Linked references read

- `C:\Users\HomePC\Desktop\skill\design-skill\references\design-system.md`
- `C:\Users\HomePC\Desktop\skill\hackathon-onboarding\references\environment-checks.md`
- `C:\Users\HomePC\Desktop\research-skill\references\phase-playbook.md`
- `C:\Users\HomePC\Desktop\research-skill\references\research-artifacts.md`
- `C:\Users\HomePC\Desktop\research-skill\references\adversarial-rules.md`

## Resulting process decisions

1. Verify official rules and Tempo capabilities before architecture.
2. Use a dedicated vault entitlement rather than pooled backend custody.
3. Keep the claim secret bearer-based and commit only its hash onchain.
4. Prove contract invariants before broad UI implementation.
5. Treat passkeys and sponsored claims as kill gates until the browser flow passes.
6. Remove recipient-selected settlement from v1 because the current Tempo FX/liquidity path is not proven.


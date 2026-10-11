# Authority boundary completion — local release-rescue candidate

Scope: complete the user-authorized payout authority boundary on `codex/canonical-payout-lifecycle`, starting at `04870b3708369d20bb48f3d8f2cdc7a13ca320fd`. No push, deployment, faucet, or live transaction is part of this work. The final execution report supplies the exact tested commit and full-suite results; this document is not itself an approval to release.

## RELEASE RED-TEAM VERDICT

OVERALL: production acceptance UNPROVEN; scoped implementation awaits the final local gate.

NORMAL USER FLOW: UNPROVEN for this candidate in production.

SAFE TO DEMO: NO new production readiness claim.

SAFE TO RELEASE/SUBMIT: NO, pending director approval and authorized live acceptance.

The Critical Bug Hunter skill was applied in release-rescue mode. Its structural sibling search expanded the repair beyond three tuple reads to partial reclaim records, malformed API records, pending claim reload, independent batch reconciliation, and capability/timeline presentation. The user's no-mutation restriction takes precedence over the skill's live acceptance-test requirement.

## P0 RELEASE BLOCKERS

### AUTH-01 — runtime shape drift broke claim and batch authority

- Impact/location: `ClaimPage`, `BatchExperience`, and diagnostic scripts assumed named properties after `getPayout`; the shared ABI returns six positional outputs.
- Reproduction: feed actual `decodeFunctionResult(vaultAbi)` output into the old named-field readers.
- Root cause: several decoding boundaries, with casts rather than complete runtime validation.
- Repair/evidence: `payoutFromContractResult` validates tuple arity, own required object fields, addresses, unsigned integer ranges, enum, and optional payout ID. API, RPC, script, and reconciliation callers use it. Tests additionally decode the contract artifact's named struct and the same serialized representation.
- Size: MODERATE. FIX BEFORE RELEASE: YES; implemented locally.

### AUTH-02 — authority gaps allowed misleading or inert recovery UI

- Impact/location: `PayoutDetail` hid missing capability while CHECKING and showed historical funding without evidence; persisted pending claims returned to a confirmation state without an active bounded operation; batch response loss rendered a failure/edit path.
- Reproduction: unavailable authority plus public metadata; pending claim reload with vault still FUNDED; one failed batch member read after provider response loss.
- Root cause: financial authority, operation progress, and private credential custody were conflated.
- Repair/evidence: canonical `capabilityState`, `historicalFunding`, complete `LivePayout`, recovery-only pending claim rendering, independent batch results, preserved capabilities, and no automatic resubmit. Browser tests preserve and strengthen the original missing-capability assertion.
- Size: MODERATE. FIX BEFORE RELEASE: YES; implemented locally.

## P1 HIGH-RISK BUGS

### AUTH-03 — low-level reclaim helper synthesized terminal authority

- Impact/location: `reclaimFlow.ts` formerly converted a string `RECLAIMED` result into a fabricated payout.
- Root cause: an outcome label was treated as equivalent to a complete current vault read.
- Repair/evidence: reconciliation now accepts runtime data, normalizes all fields, and uses the canonical resolver. Initial null/malformed reads fail before submission; ambiguous submitted operations remain recovering.
- Size: SMALL. FIX BEFORE RELEASE: YES; implemented locally.

Outside this authorization boundary, recipient onward-transfer receipt truth still requires its own acceptance evidence. It is not a `getPayout` decoding exception or a claim of completed live UAT.

## P2 / P3

No layout or branding changes. Malformed public-history formatting and provider UX beyond the payout authority boundary remain separate work, not a reason to fabricate financial state.

## USER JOURNEY MATRIX

| Step | Evidence in this candidate |
| --- | --- |
| Decode RPC tuple/artifact struct/API data | Cross-boundary runtime tests |
| Decide active vs expired | Validated vault record plus chain time only |
| Claim response lost, vault CLAIMED | Production claim reconciliation helper; terminal wins without time |
| Claim response lost, vault FUNDED/unavailable | Bounded recovery, one submission, browser pending-reload protection |
| Batch response lost, one read unavailable | Independent member reads and public-record persistence; capabilities retained |
| Activity/detail without local bearer | CHECKING plus MISSING, no active/funded assertion |
| Sender reclaim authorization | Shared canonical readiness guard; local EDR contract tests |
| Fresh physical-passkey production lifecycle | UNPROVEN; intentionally not run |

## STATE-MACHINE BUGS

Removed: decode failure to partial authoritative record; transport text to claim revert; pending-record reload to idle confirmation spinner; unavailable batch read to discarded sibling authority; string outcome to synthesized RECLAIMED; unknown timeline to active. Execution journals remain distinct from financial status.

## AUTHORITY MATRIX

| Input | What it proves | What it does not prove |
| --- | --- | --- |
| Complete current normalized vault read | Raw status and immutable payout identity | Expiry without chain time |
| Valid chain timestamp | Before/at/after expiry for FUNDED | Funding, claim, or reclaim by itself |
| `/api/payout/:id` | Fresh validated server vault read; `Cache-Control: no-store` | Discovery-derived guesses |
| `/api/payouts/:sender`, local public index | Discoverable IDs and historical metadata | Current financial lifecycle/actions |
| Provider/hash/receipt | Operation progress or receipt outcome | FUNDED without vault confirmation |
| Session bearer | Local private-link availability | Financial status or sender reclaim authority |

## RECOVERY VERDICT

Response loss uses bounded authoritative reads without another submission. Missing data never becomes NONE or a terminal status. A missing bearer cannot be invented; it remains a separate custody limitation. Terminal states do not require chain time. Batch member confirmation is persisted independently, preserving existing public hashes and private session credentials.

## MULTI-USER VERDICT

PARTIAL. Local contract tests cover ownership and claim races; the batch click guard blocks same-render duplicate invocation. This work does not claim cross-tab/provider concurrency or two physical-user acceptance.

## DATA / VALUE VERDICT

Local contract accounting/atomicity/access-key regressions are included in the final suite. No live balances changed. Historical replay uses actual `eth_call` bytes at Moderato block `37566216`, timestamp `1790775847` in `test/fixtures/moderato-authority.json`, obtained with `scripts/replay-authority.ts` (read-only).

## FRONTEND TRUTH VERDICT

Scoped expectations: canonical current lifecycle only; historical funding only from complete vault evidence; capability AVAILABLE/MISSING/NOT_APPLICABLE independent of financial state; no claim/reclaim authorization with missing chain time. Final full browser results belong to the execution report.

## SECURITY VERDICT

PARTIAL, not a full security certification. The tracked-file scan checks literal operator keys, private-key PEMs, literal bearer URLs, and forbidden tracked secret-storage paths, and prints only rule names/filenames. Existing browser sentinel tests check DOM, network, and console redaction. No real operator keys or owner capabilities are loaded by this gate.

## PRODUCTION DRIFT

LOCAL: new candidate on the reconstruction branch.

REMOTE: local `origin/main` reference remains `6a4bdee473c0b1e5c1490cdf777b3028e5792f0b` at start; no push requested.

FRONTEND/BACKEND/WORKER/CONFIG: not deployed or changed by this task. Production source identity is not reasserted by local checks. DRIFT is intentional pending director review.

## TEST COVERAGE BLIND SPOTS

1. Tuple-only or object-only mocks can miss ABI/runtime drift. Added actual shared-ABI tuples and artifact-ABI structs.
2. Simplified status-only fixtures can pass despite missing addresses/numbers. Added complete validation and malformed-field matrix.
3. A successful provider mock can hide response loss. Added production claim-helper and batch-helper failure injection, bounded reads, and single-submit assertions.
4. A missing-capability test can hide incorrect current financial copy. Strengthened the real Activity/detail browser assertions rather than dropping the notice.
5. Polling tests alone can miss reload after a pending submission. Added real ClaimPage pending-reload/status-check browser coverage.
6. A green local suite cannot prove physical Google Password Manager/WebAuthn latency, durable production KV, sponsor availability, or a full two-user lifecycle. Still UNPROVEN; director-controlled UAT required.
7. RPC shape correctness cannot prove an endpoint never serves a stale chain view. Fixed no-store API semantics and bounded unavailable reads do not replace upstream trust/finality assumptions.
8. Session storage may be lost on close/eviction; no cross-device or PC-restart bearer persistence is claimed.

## TOP 5 THINGS MOST LIKELY TO BREAK THE DEMO/RELEASE

1. Physical passkey/provider/sponsor behavior untested by this candidate's live flow.
2. RPC availability or stale upstream responses.
3. Lost bearer capability after closing the tab/browser.
4. Cross-tab operations or account changes while an old request is pending.
5. Ancillary onward-transfer UX beyond the scoped canonical payout authority migration.

## MINIMUM RELEASE FIX PLAN

MUST FIX: complete the scoped local release checks; do not promote if any required suite fails.

SHOULD FIX/VERIFY: director-authorized representative two-user production acceptance and ancillary value-flow truth before claiming whole-product readiness.

DO NOT TOUCH BEFORE APPROVAL: shared main, deployment, vault, fees, physical credentials, live funding/claim/reclaim/faucet.

## INTENTIONAL DECODING / LIFECYCLE EXCEPTIONS

- Contract-only tests (`ReachPayoutVault.ts`, `batchAtomicity.test.ts`) may use artifact-native structs to test the contract library; production readers do not.
- `senderRecovery.ts` merges historical public records and clears historical execution markers; it cannot grant current actions. All rendered current lifecycle still requires a normalized current read.
- `senderFunding.ts` asks the canonical resolver for validated `vaultStatus` to confirm a funding operation. This is historical operation evidence, not an expiry-dependent claim/reclaim decision.
- `claimCapability.ts` / `senderStorage.ts` nullable catches are local credential/public-history recovery, never a financial RPC or authorization fallback.
- `identityRecovery.ts` uses wall time for authentication-record TTL, not payout expiry. Date formatting, IDs, filenames, and journal timestamps are not financial eligibility.
- Diagnostic integration scripts retain explicit safety assertions after shared normalization. `integration-moderato.ts` and `create-claim-link.ts` are NOT executed by this gate because they mutate the chain.

## FINAL ANSWER

The three structural work packages are strict normalization, canonical authority/recovery, and independent capability/timeline presentation. READY FOR CODE CHANGES: already explicitly authorized for this scope only. Ready for promotion or live UAT: requires director approval after the exact-commit local gate.

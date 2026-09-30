# Expiry authority regression: root cause and local correction

Investigated against production source `6a4bdee473c0b1e5c1490cdf777b3028e5792f0b`.
No transactions were sent. No deployment or push is authorized by this report.

## Proven failure

The deployed `SenderDashboard.readPayoutStrict` assumes `readContract(getPayout)`
returns named object fields. The actual viem ABI decoder returns a six-element
tuple. Reading `result.amount.toString()` throws:

`TypeError: Cannot read properties of undefined (reading 'toString')`

`readPayout` catches this and returns null. `publish` consequently adds no live
entry to the status map, even when its independent latest-block read succeeds.
Discovery persists a public record with `submissionState: CONFIRMED`, but does
not preserve the authoritative status as a live entry. The resolver's fallback
returns financial UNKNOWN / display DISCOVERED with the false label
`Funded · Waiting for recipient`. Detail's final timeline branch then renders
`Active until ...` solely because `isExpired` is false.

Classification: F (tuple decoding) is the demonstrated first broken boundary;
B (time cannot reach a missing live entry), D (missing time interpreted as
unexpired when FUNDED does reach the resolver), and E (timeline assumes active
from a false isExpired flag) are additional proven structural defects. A/C are
not proven causes: direct latest-block reads succeeded during diagnosis.

## Exact public reproduction

Target: `32623884757742957646259674214505491779688334013179864495367932908249507365629`.
Direct vault read at block 37566216: status 1, amount 10000, expiry 1790720335,
sender `0x6B6e9e45Cf4bB5CbC7d4a8B19cf3d886369Ff925`, zero claimant,
claimSigner `0x7Ad068B42c3652A73EB2cB82ffCd5A8DF30bAa57`.
Chain timestamp: 1790775847 seconds.

After the demonstrated decode failure, Detail receives no live entry:
authoritativePayout = undefined, chainTimestamp = undefined. The expiry used by
its timeline is the public record's `1790720335`; the main resolver does not
receive it as authoritative expiry. Detail passes the public record as its
operationJournal (submissionState CONFIRMED), not the separate operation store.
The friendly-label call passes expectedExpiry 1790720335 from that same record.

The exact old resolver output reproduced was:

```json
{"financialState":"UNKNOWN","displayState":"DISCOVERED","isExpired":false,"isClaimable":false,"isReclaimable":false,"canRevealClaimLink":false,"allowedActions":["CHECK_STATUS"],"statusLabel":"Funded · Waiting for recipient","requiresRecovery":false,"authoritative":false}
```

This reproduces the owner's rendered label and active timeline. The owner's
private browser session was not inspected: its connectedAccount,
capabilityPresent boolean, and complete local public journal fields are not
observed facts. Neither account nor capability changes the defective fallback.
No capability-bearing storage was read.

## Public payout matrix

Discovery returned seven payouts, rather than the five described in the request.
All were directly read from the vault at the same block/time above. The old
decoder throws for every row; every discovered confirmed record follows the
same UNKNOWN/DISCOVERED/Waiting-for-recipient path. This column is a production
source reproduction using real public inputs, not inspection of the owner's DOM.

| Payout ID | Raw status | Expiry | Expected lifecycle at 1790775847 | Old rendered fallback |
| --- | --- | --- | --- | --- |
| 90151727528187833753684045857026439861949979472721168811828983171085526033230 | 1 | 1790778405 | FUNDED | Waiting for recipient |
| 115543697009702443829310569687238708172992164666670857559776125647687181587510 | 1 | 1790766636 | EXPIRED_FUNDED | Waiting for recipient |
| 113534573245704110907651654435970065347715436922429705419659504619606705960652 | 1 | 1790758081 | EXPIRED_FUNDED | Waiting for recipient |
| 5827182645165307820791179257379778280885723597263831681079614285211331579015 | 3 | 1790753723 | RECLAIMED | Waiting for recipient |
| 32623884757742957646259674214505491779688334013179864495367932908249507365629 | 1 | 1790720335 | EXPIRED_FUNDED | Waiting for recipient |
| 93498073433633701930643344717792503450852015904643172103856357342860799929715 | 1 | 1790719693 | EXPIRED_FUNDED | Waiting for recipient |
| 24599730976579210805774763736135222048697658670242430770008130491816224571791 | 1 | 1790795442 | FUNDED | Waiting for recipient |

## Clock and surface audit

Old source: refreshPayouts -> publish -> publicClient.getBlock(latest), no timeout,
exception swallowed to undefined; timestamp copied into each successful live
entry. Two publishes fetched separately, no periodic update. Detail/Activity/Home
all use the resolver (Activity through getFriendlyStatus), all receive this same
map. None independently compares browser time to expiry. Date conversion in the
timeline is seconds * 1000 for presentation; no units error was found. The old
reader checked undefined but not null; an optional missing publicClient also
silently yielded undefined.

Correction: readPublicPayout uses the existing tuple/object decoder and a bounded
10-second read. A single useChainClock in SenderDashboard owns all three surfaces'
timestamp, independently of individual payout success. It fetches immediately,
every 15 seconds, on focus, and on Activity refresh. Reads deduplicate, time out
at 10 seconds, invalidate authority on failure, and retain a monotonic high-water
mark across retries/navigation. A hard refresh starts CHECKING and rereads chain
time; no wall-clock estimate or persisted browser time is used. Polling may lag a
new block; a failed read cannot leave a confidently active payout.

The resolver returns UNKNOWN/CHECKING without chain time, exposes no claim or
reclaim action, and no longer treats a confirmed public discovery record as live
financial truth. Timeline waiting/active wording requires resolved FUNDED.
Stale local failure copy no longer overrides a terminal authoritative status.

## Regressions

expiryAuthority.test.ts covers ABI-realistic tuple decoding, before/equal/after
expiry, missing time, rejected/timed-out clock reads, three rendered surfaces,
deduplication, backward block responses, failure/recovery, and terminal authority.
expiry-authority.spec.ts exercises the actual React clock and surfaces through
mock-only failure, expiry, Activity/detail navigation, and backward clock input.
The discovery test now requires a live payout plus known time before asserting
the active label. No transaction callback is exercised.

Validation: 163 Node tests passed (including local contract/batch/agent tests).
After the final dashboard classification change, all 26 affected lifecycle and
discovery tests passed again. TypeScript passed; the local browser regression
passed including hard reload -> CHECKING -> fresh chain time -> EXPIRED_FUNDED.
Vite production build, API bundle build, and git diff --check passed. The browser
harness initially imported a second React instance; using Vite's exact versioned
module URLs fixed that harness error. No test timeout or product fixture behavior
was relaxed. The full unrelated browser suite was not rerun for this change.

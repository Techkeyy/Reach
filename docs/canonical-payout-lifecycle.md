# Canonical payout lifecycle

This document records the lifecycle boundary introduced by the canonical
reconstruction. It is an implementation record, not a claim that live owner
UAT has passed.

## Authority hierarchy

1. `ReachPayoutVault.getPayout(payoutId)` is the financial authority.
2. The latest Tempo block timestamp is the expiry authority.
3. A successful receipt proves execution, but does not replace the vault read.
4. The operation journal, API/indexer discovery, hashes, and React state are
   recovery and presentation evidence only.
5. A bearer claim capability is private delivery material. It controls only
   whether Reach can reveal a claim link; it cannot make a payout funded,
   claimed, or reclaimed.

Known terminal vault states always win over local uncertainty:

| Vault state | Canonical financial state | Allowed sender/recipient interpretation |
| --- | --- | --- |
| `NONE` | `NONE` | No funded payout is proven; an unresolved operation may still require review. |
| `FUNDED` before chain expiry | `FUNDED` | Recipient may claim; sender may not reclaim. |
| `FUNDED` at/after chain expiry | `EXPIRED_FUNDED` | Sender may reclaim only when the connected account is the recorded sender. |
| `CLAIMED` | `CLAIMED` | Terminal; never downgraded by stale local state. |
| `RECLAIMED` | `RECLAIMED` | Terminal; never downgraded by stale local state. |

When the authority read is unavailable, the resolver returns `UNKNOWN`,
`CHECKING`, or `RECOVERING`; it never fabricates `FUNDED`, `CLAIMED`, or a
claim link.

## Resolver and operation state

`src/client/payoutLifecycle.ts` exposes `resolvePayoutLifecycle`. Its output
contains the financial state, display state, chain-time expiry, allowed
actions, link availability, and recovery requirement. Sender dashboard,
activity, and payout detail use this output for their status interpretation.

The operation execution states are:

`IDLE → PREPARED → AWAITING_SIGNATURE → SUBMISSION_ATTEMPTED →
HASH_RECEIVED → CONFIRMING → CONFIRMED`

Failure/recovery branches are explicit:

`FAILED_BEFORE_SUBMISSION`, `FAILED`, `RECOVERING`, and
`SUBMISSION_UNCERTAIN`.

The shared `submitAndReconcile` boundary persists the intent before the
provider call, records the submission boundary immediately before that call,
records a returned hash when present, waits for a bounded receipt, and then
performs bounded authoritative reads. A provider exception after the boundary
never becomes a safe pre-submission failure and the engine never resubmits
automatically.

## Durable journal and private material

`src/client/operationJournal.ts` stores public operation metadata in durable
browser storage. Entries include operation type/id, payout ids, expected
sender/recipient/amount/expiry/signer, transaction hash, execution state, and
sanitized failure text. It never stores bearer capabilities, passkey material,
WebAuthn challenges, or private keys.

Public sender payout records are durable through `senderStorage.ts` and are
safe to rediscover from the API/indexer. Claim capabilities remain in the
dedicated client-only capability store. A browser restart can recover public
payout metadata, but it is not expected to recover a bearer capability unless
the owner deliberately retains the original delivery channel.

## Migrated financial paths

- Single funding persists public metadata and capability before submission and
  uses the common engine to resolve `FUNDED` by payout id after response loss.
- Reclaim validates sender, vault status, and chain expiry before entering the
  common engine. Its UI has explicit checking, submitting, confirming,
  recovering, failed, uncertain, and reclaimed outcomes.
- Claim re-reads authoritative payout state, uses chain time, journals the
  operation before the relay/provider boundary, and treats the vault's
  `CLAIMED` state as the success gate.
- Batch funding creates all public records and capabilities before its atomic
  submission and resolves success only when every payout matches the expected
  authoritative vault fields.
- Agent configuration and the CLI derive expiry from Tempo chain time. The CLI
  requires an explicit private claim-link handoff file and prints only redacted
  link metadata.

## Remaining product limits and release gate

Discovery is not authority, and a discovered payout without a capability must
not invent a link. Browser display timestamps such as “2m ago” are cosmetic;
they are not financial predicates. Existing identity-recovery TTL handling is
an authentication-session concern and is separate from payout expiry.

This branch is not `RELEASE READY` from tests alone. Production deployment and
the core outcome remain gated on a clean full regression matrix, exact source
and deployment verification, and three consecutive owner-controlled live
journeys: the existing expired reclaim payout, a new tiny payout, and a fresh
recipient claim.

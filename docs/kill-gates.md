# Reach Kill Gates

Status date: 2026-09-21

These gates block feature expansion. A gate is not passed because a design sounds plausible or because an official primitive exists in isolation.

## Kill Gate 1

**Question:** Can a funded payout be safely represented without relying on an unsafe pooled hot-wallet accounting scheme?

**Current status:** HOLD, architecture candidate passes by design, not by implementation proof.

**Required evidence:** Non-upgradeable vault contract holds exact token balances; local and testnet tests prove funding cannot create an underfunded record; no sender private key or pooled payout balance lives in the backend.

## Kill Gate 2

**Question:** Can exactly one successful claim occur even under concurrent or replaying attempts?

**Current status:** HOLD, state machine is designed but not tested.

**Required evidence:** Two concurrent claim attempts with the same secret produce one success and one revert; second claim after confirmation reverts; UI and API do not create duplicate financial actions on refresh.

## Kill Gate 3

**Question:** Can expiry/reclaim and claim be made mutually safe?

**Current status:** HOLD, state machine is designed but not tested.

**Required evidence:** Boundary tests before, at, and after expiry; claim/reclaim race tests; reclaim after claim reverts; claim after reclaim reverts; unknown receipt recovery is explicit.

## Kill Gate 4

**Question:** Can the recipient onboarding and claim path complete without requiring an existing conventional crypto wallet?

**Current status:** HOLD, official Tempo documentation supports a WebAuthn-oriented path, but Reach has not run the browser ceremony.

**Required evidence:** Mobile and desktop browser test with a new supported passkey account, claim link opened cold, no sender-collected recipient address, and exact token received.

## Kill Gate 5

**Question:** Can sponsored-fee behavior work through the intended actual user flow?

**Current status:** HOLD, official fee sponsorship docs and endpoint reachability are proven, actual claim sponsorship is not.

**Required evidence:** Recipient with no testnet fee balance creates or uses the supported account, signs the claim, fee sponsor accepts the exact transaction, and the claim settles. Rejection, sponsor outage, and insufficient sponsor liquidity have human recovery states.

## Kill Gate 6

**Question:** Can authoritative onchain state be reconciled into the app reliably?

**Current status:** HOLD, no contract or indexer exists.

**Required evidence:** Confirmed lifecycle events populate the backend, restart replay is idempotent, receipt-unknown state is visible, frontend never shows claimed from an optimistic response, and direct vault reads agree with the derived database state.

## Kill Gate 7

**Question:** Can recipient-choice settlement actually be implemented with currently supported Tempo liquidity and infrastructure?

**Current status:** KILL FOR V1.

**Reason:** Current official Tempo material describes on-chain FX and non-USD stablecoin support for direct onchain liquidity as coming soon. The current Fee AMM material is about fee conversion, not a proven arbitrary payout settlement route. Reach removes this feature from v1 rather than simulating it.

## Kill Gate 8

**Question:** Can an MPP payment map safely and idempotently to exactly one payout?

**Current status:** DEFERRED.

**Reason:** Official MPP and `mppx` support is documented, but the Reach mapping, duplicate prevention, reconciliation, and recovery path do not exist. MPP becomes future work until a design and test prove one payment challenge, one settlement, one payout ID, and safe retry behavior through the same vault engine.

## Phase 0 gate

Phase 0 is **not yet passed**. The safe architecture is selected, but Gates 1 through 6 still need implementation evidence. The next task is the contract core and its adversarial tests.


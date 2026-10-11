# Reach Director State

Last updated: 2026-10-11
Current status: TASK 010A — PROTECTED PREVIEW VERIFIED / STABLE ORIGIN AND DURABLE KV BLOCKED
Current phase: INFRASTRUCTURE UNBLOCK / OWNER UAT GATE
Phase 2 status: UAT PASS
Phase 3 status: BLOCKED — isolated financial staging owner provisioning required; live UAT pending
Deployment status: SSO-PROTECTED APPLICATION PREVIEW + SCREENSHOT GALLERY PUBLISHED; FINANCIAL STAGING NOT PROVISIONED
Submission status: HOLD

## Task 010A — infrastructure unblock follow-up (2026-10-11)

### Exact audit result

- Local branch: `codex/reach-task-007-staging-rc`; local HEAD is the final local `docs: record Task 010A staging audit` commit, with a clean worktree. The exact local SHA is reported from the final verification below. Remote RC remains `16ce4eb656da7031f045699c9a878db06022b6bc`; `origin/main` remains `5c5504227e83a55ee94eac81c4025e93c4874ae6`; no push was made.
- The isolated Vercel project was re-read through the Vercel API and CLI. The project is `techkeyys-projects/reach-financial-staging` (`prj_VtB8GS8EA1UAMpEsyjuii2Sq2fWc`), and its current protection is `ssoProtection.deploymentType=all_except_custom_domains` with Git fork protection enabled.
- The project has **no formal Vercel Git `link` object** (`hasLink=false`). Its `gitProviderOptions.createDeployments` flag is enabled, and the existing Preview carries Git metadata from the manual deployment, but there is no configured branch Preview automation that can provide a stable, branch-derived origin. A stable Git branch Preview URL therefore could not be established.
- The only active staging deployment is Preview `dpl_CMKsUTiZAL1rXsuachVw8ysUWjFz`, URL [protected staging Preview](https://reach-financial-staging-8cmfrt4a1-techkeyys-projects.vercel.app), status `READY`, target `preview`. The deployment metadata identifies the locally reviewed application tree at `755133006e8532ad15b99e9d7c427034e2a74743` (`docs: record Task 009 staging handoff`); it is not the current local documentation commit and is not being represented as the current release-candidate SHA.
- An unauthenticated `HEAD /` to the Preview returned `302 Found` to Vercel SSO, with `X-Frame-Options: DENY` and `X-Robots-Tag: noindex`. This is the only origin currently proven protected.
- The project has no active alias or custom domain in the project API response. `https://reach-financial-staging.vercel.app/` returns `404`; the earlier accidental production-target deployment `dpl_GMKtRr3ejz6VaJnqxvnHsj2kiito` remains deleted. No replacement production-target deployment was created.
- The staging project environment API returned `envs=[]` for the project. The staging project has no attached KV, RPC, WebAuthn, agent, MPP, fee-payer or settlement configuration. The team has marketplace installations, but `vercel integration list reach-financial-staging` returned **No resources found**, so no authorized staging Redis/KV resource was available to attach.
- The local checkout remains linked to the production project only for CLI context (`.vercel/project.json` points to `reach`); it was not used to inspect or mutate production values. No production project, production aliases or production variables were changed.

### Task 010A gate decision

The smallest safe isolated staging environment is **not complete**. A protected commit-specific Preview exists, but the stable origin, provider-backed durable KV, staging-only server secrets, deployed passkey ceremonies and healthy Linux/CI regression path are still unavailable. This is an infrastructure boundary, not a product-code failure. Release remains **HOLD** and all financial mutations remain stopped.

### Task 010A evidence and remaining gates

| Gate | Observed result | Status |
|---|---|---|
| Stable Git branch Preview | Project API has no Git `link`; no stable branch-derived URL | **OPEN** |
| Protected stable origin | Project alias is 404; existing protection excludes custom domains | **OPEN** |
| Preview isolation | Preview redirects unauthenticated requests to SSO; no alias, no envs | **PASS** |
| Accidental public deployment | Exact deployment deleted; stable alias returns 404 | **PASS** |
| Independent durable KV | No staging marketplace resource; provider CAS/restart proof not possible | **OPEN** |
| Non-financial staging secrets | No staging secret bundle attached | **OPEN** |
| Two fresh deployed passkey users | No stable origin/RP/KV, so no ceremonies attempted | **OPEN** |
| Healthy Linux/CI complete regression | WSL access denied; no CI dispatch/push authorized | **OPEN** |
| Financial mutations | No faucet, funding, claim, access-key signature, MPP payment or settlement | **PASS — stopped** |

### Single owner action required next

Open [Vercel Deployment Protection for `reach-financial-staging`](https://vercel.com/techkeyys-projects/reach-financial-staging/settings/deployment-protection) and enable **Vercel Authentication / All Deployments** for this isolated project. Do not deploy a stable project alias until an unauthenticated probe to that alias returns `302` to SSO; then return only the protected staging URL. This is the one owner action requested at this boundary. KV provisioning and secret attachment remain separate, unperformed gates.

### Task 010A recommendation

Reject financial-staging readiness and keep **RELEASE HOLD**. The project boundary and protected Preview are proven, but it would be unsafe to claim deployed financial staging or start owner UAT without a stable protected origin, an independent durable KV, staging-only server configuration and a healthy reproducible regression environment.

## Task 010 — infrastructure unblock (2026-10-11)

### Core outcome and release posture

- Release posture remains **HOLD**. The isolated Vercel project and protected Preview shell now exist, but financial staging is not operational because no stable protected origin, durable staging KV, server-only MPP/agent secrets or independent settlement authority has been provisioned.
- The accepted application code was preserved. No redesign, payment-code rewrite, production project change, live transaction, owner signature or production-secret action was performed.
- The Task 009 director handoff was reviewed and committed locally as `7551330` (`docs: record Task 009 staging handoff`). The remote candidate remains at the expected code baseline `16ce4eb656da7031f045699c9a878db06022b6bc`; no push was made.

### Isolated Vercel project and deployment

- New project: `techkeyys-projects/reach-financial-staging`.
- Project ID: `prj_VtB8GS8EA1UAMpEsyjuii2Sq2fWc`.
- Project protection readback: `ssoProtection.deploymentType=all_except_custom_domains`; Git fork protection enabled.
- Preview deployment: `dpl_CMKsUTiZAL1rXsuachVw8ysUWjFz`.
- Preview URL: [Reach financial staging Preview](https://reach-financial-staging-8cmfrt4a1-techkeyys-projects.vercel.app).
- Preview target: `preview`; Vercel status: `READY`.
- Unauthenticated `HEAD /` on the Preview returned `302 Found` to Vercel SSO with `X-Frame-Options: DENY` and `X-Robots-Tag: noindex`.
- Preview environment variables: **none**. Production environment variables: **none**. No KV, fee payer, agent encryption, MPP, settlement, WebAuthn or RPC secret was attached.
- The build completed with the current pnpm 11 allowlist and generated the client plus API bundle. The deployment was created from the local release-candidate tree whose only post-baseline change was the committed director documentation; the application code remains the expected `16ce4eb` content.
- A first deployment accidentally landed as a Vercel `target=production` deployment inside the new staging project because the CLI invocation did not honor the intended target. It had no environment variables and was removed immediately by exact deployment ID `dpl_GMKtRr3ejz6VaJnqxvnHsj2kiito`. Its stable alias now returns `404 DEPLOYMENT_NOT_FOUND`. The protected Preview is the only remaining staging deployment, and the existing `reach` and visual-review projects were not changed.
- Stable origin status: **OPEN**. `reach-financial-staging.vercel.app` is not currently serving a deployment. The owner must attach a stable non-production domain or an approved protected project alias before WebAuthn configuration can be set. The commit-specific Preview URL must not be used as the final WebAuthn identity boundary.

### Playwright skip inventory and classification

The eight skipped tests are explicit `test.skip(Boolean(process.env.TARGET_URL), ...)` cases. They are not hidden failures:

| Test | Skip reason | Classification | Coverage status |
|---|---|---|---|
| `batch-claim-recovery.spec.ts` — “Activity opens a funded batch payout with its sender-local Copy claim link action” | “Local module fixture only; never inject into a deployed app” | Requires the local Vite/module-fixture environment | Covered by the local harness; intentionally inapplicable to a deployed `TARGET_URL` |
| `expiry-authority.spec.ts` — “shared chain clock keeps Home, Activity and Detail truthful through failure and navigation” | “Local module fixture only; never inject into a deployed app” | Requires the local Vite/module-fixture environment | Covered by the local harness; intentionally inapplicable to a deployed `TARGET_URL` |
| `testnet-funding.spec.ts` — “copy, requesting, waiting, authoritative success and next action” | “Fixture harness uses local Vite, not deployment.” | Requires the local Vite/mock HTTP environment | Covered locally; intentionally excluded from deployed-target testing |
| `testnet-funding.spec.ts` — “component renders requesting and waiting while their requests are held, with duplicate actions disabled” | Same | Requires the local Vite/mock HTTP environment | Covered locally; intentionally excluded from deployed-target testing |
| `testnet-funding.spec.ts` — “faucet failure shows without automatic retry” | Same | Requires the local Vite/mock HTTP environment | Covered locally; intentionally excluded from deployed-target testing |
| `testnet-funding.spec.ts` — “success with unchanged balance is rejected” | Same | Requires the local Vite/mock HTTP environment | Covered locally; intentionally excluded from deployed-target testing |
| `testnet-funding.spec.ts` — “funding layout 375px” | Same | Requires the local Vite/mock HTTP environment | Covered locally; intentionally excluded from deployed-target testing |
| `testnet-funding.spec.ts` — “funding layout 1280px” | Same | Requires the local Vite/mock HTTP environment | Covered locally; intentionally excluded from deployed-target testing |

There is no critical missing coverage hidden by these skips. The two module fixtures and six funding fixtures are deliberately unsafe to inject into a deployed app; the supported local Playwright target is the correct environment for them. Deployed Preview coverage remains limited to protected shell/build inspection because no credentials are present.

### Healthy Linux/CI regression boundary

- A healthy Linux/CI runner was not available in this session. WSL enumeration returned `E_ACCESSDENIED`, and no GitHub/CI push or workflow dispatch was authorized.
- The Windows host-only `uv_os_get_passwd` ENOMEM defect remains documented in Task 009. No financial code was modified to work around it.
- Local contract proof remains **40 passing, 0 failing** under the narrow temporary host preload. The complete browser regression remains **77 passed, 0 failed, 8 skipped**; the eight skips are catalogued above. The latest duplicate unit reruns remain **incomplete/stalled**, not silently passed; the last completed unit result is **163 passed, 0 failed, 0 skipped**.

### Durable KV and secure configuration status

- Separate staging KV/Redis resource: **NOT PROVISIONED**.
- Provider-backed persistent-record proof: **OPEN**.
- Provider-backed atomic CAS race across independent instances: **OPEN**.
- Restart/reconnection proof against the real staging adapter: **OPEN**.
- Fail-closed behavior without durable storage: **LOCAL PASS**, deployed configuration proof OPEN.
- Agent signer encryption key: **NOT ATTACHED**.
- MPP challenge secret and identity secret: **NOT ATTACHED**.
- Independent MPP recipient: **NOT ATTACHED**.
- Settlement authority: **NOT ATTACHED**.
- Stable `REACH_ORIGIN`/`REACH_RP_ID`: **NOT ATTACHED**.
- Tempo Moderato RPC/indexer configuration: **NOT ATTACHED**.
- No production KV, fee payer, signer, session or vault configuration was reused.

The current Vercel authorization was sufficient to create the isolated project and deploy a protected empty shell, but no authorized provider-backed KV resource or owner-controlled staging secret bundle is available in this session.

### Two-user authentication and financial stop boundary

- User A fresh deployed passkey registration: **OPEN** — no stable configured origin.
- User B independent deployed passkey registration: **OPEN** — no stable configured origin.
- Return/recovery and cross-account authorization rejection: **OPEN** for deployed proof; local authz/identity tests remain passing.
- Funding, human payout, claim/reclaim, access-key signing, MPP settlement, channel funding and channel close: **NOT STARTED**.
- No faucet request, owner access-key signature, payout, claim/reclaim, MPP settlement or other financial mutation was initiated.

### Task 010 Claim → Mechanism → Boundary → Proof ledger

| Claim | Mechanism | Boundary | Proof / status |
|---|---|---|---|
| Staging is separate from production | New Vercel project `reach-financial-staging` with its own project ID | Existing `reach` project and visual-review project untouched | **PASS**: project inventory and project ID verified |
| Staging Preview is protected | Vercel SSO deployment protection | No custom domain or secret bypass; no public Preview access | **PASS**: Preview `302` to SSO, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex` |
| Staging contains no production credentials | Empty Preview and Production env sets | No KV, fee payer, signer, MPP or WebAuthn secret attached | **PASS**: both env listings empty |
| Stable WebAuthn origin exists | Project alias/custom domain | Commit-specific Preview host cannot be final RP boundary | **OPEN**: owner domain/protection action required; project alias is currently 404 |
| Durable financial state exists | Provider Redis/KV with atomic CAS | Local fixtures cannot substitute for real provider proof | **OPEN**: no staging KV provisioned |
| Financial actions remain stopped | No owner signature or money-moving request issued | UAT begins only after explicit owner action | **PASS**: no live financial mutation |

### Current feature-completion matrix

| Surface | Local implementation | Isolated staging | Task 010 status |
|---|---|---|---|
| Landing / UX / FAQ | Verified | Protected shell build available | **PASS local / Preview visual only** |
| Passkey registration and return login | Browser identity suite passes locally | Stable origin/RP/KV absent | **OPEN deployed** |
| Authenticated balance and activity | Local deterministic/authz coverage | No financial env or RPC | **OPEN deployed** |
| Funding and human payments | Local browser/contract/unit proof | Faucet and payment intentionally not started | **OPEN owner UAT** |
| Agent authorization and MPP | Local policy, receipt, output, UNKNOWN and revocation proof | Agent/MPP secrets and recipient absent | **OPEN owner UAT** |
| Provider CAS/restart recovery | Local adapter tests | Separate provider not provisioned | **OPEN** |
| Two-user isolation | Local negative authz coverage | No deployed user ceremonies | **OPEN owner UAT** |

### One next owner action

Provision the separate durable staging KV and the minimum server-only secret bundle through the authorized provider/Vercel secret-management workflow, and attach it to `reach-financial-staging` behind a stable protected non-production HTTPS origin with matching `REACH_ORIGIN`/`REACH_RP_ID`. Return only the stable staging URL and confirmation that the variables are attached; do not send secret values. After that, stop again before money moves and perform the two-user authentication/CAS proof.

### Task 010 recommendation

**Recommendation: accept the infrastructure skeleton, reject financial-staging readiness, and keep `RELEASE HOLD`.** The protected Preview proves project separation and reproducible build, but the acceptance criterion is not met until the stable origin, real provider-backed KV, server-only secrets and two independent deployed passkey users are proven. No live financial transaction should be attempted yet.

## Task 009 — final financial staging (2026-10-11)

### Director decision and exact release baseline

- Release posture: **HOLD**. The accepted UX, FAQ, authenticated application surfaces and local financial controls remain on the reviewed release candidate; no production deployment, live transaction, owner signature or production-secret action was performed.
- Branch: `codex/reach-task-007-staging-rc`.
- Local HEAD: `16ce4eb656da7031f045699c9a878db06022b6bc`.
- Remote release-candidate HEAD: `16ce4eb656da7031f045699c9a878db06022b6bc`.
- `origin/main`: `5c5504227e83a55ee94eac81c4025e93c4874ae6` (`fix: secure testnet funding abuse limits`); it remains unchanged.
- The worktree was clean at the baseline. Final status is docs-only ` M director.md`; no source or generated tracked file changed during Task 009 verification, and no commit or push was made.

### Verification completed

- `pnpm typecheck` — **PASS**.
- `pnpm build:web` — **PASS**. Vite transformed 2,229 modules and the API bundle completed; the existing large-client-chunk warning remains informational.
- `node scripts/check-api-drift.mjs` — **PASS** (`api/index.js` matches `src/server/serverlessHandler.ts`).
- `node scripts/scan-release-secrets.mjs` — **PASS** (`196` tracked files scanned, `findings=[]`).
- `git diff --check` — **PASS**.
- Contract suite — **PASS: 40 passing, 0 failing**. The healthy run used a temporary host-only `NODE_OPTIONS` preload that replaces the Windows `os.userInfo()` call and elevated access for Hardhat's global compiler-cache mutex; the preload was removed immediately afterward. The ordinary unmodified `pnpm test` command is **not** counted as passed because this host fails before Hardhat loads tests with `uv_os_get_passwd returned ENOMEM`.
- Complete browser regression — **PASS: 77 passed, 0 failed, 8 skipped** in 6.3 minutes with one worker. Playwright owned fresh API/Vite web servers, and the identity-continuity file passed **5/5** inside that run. A preceding manually-started-server run produced `59 passed / 10 failed / 8 skipped`; it was invalidated as a harness result because the browser was pointed at a stale child on port 8787. Its console recorded 503/400/404 transport errors and timeouts. After exact process cleanup, the Playwright-managed clean run passed 77/77.
- Focused identity continuity — **PASS: 5 passed, 0 failed** in 1.3 minutes under the clean Playwright-managed server setup. Registration, return identity, lost-response reconciliation, one-ceremony retry, unknown-passkey rejection and expiry cleanup assertions remain active.
- Fresh duplicate `pnpm test:unit` rerun — **INCOMPLETE / STOPPED**, not counted as a pass: it emitted passing tail cases and then made no progress for several minutes under the same host resource pressure. A second serial `tsx --test --test-concurrency=1 --test-force-exit` attempt exhibited the same stall. The last completed unit result remains the documented **163 passed, 0 failed, 0 skipped** from the accepted release-candidate verification.

### Windows ENOMEM and browser-harness diagnosis

- Direct reproduction on this execution host: `node -e "const os=require('node:os'); console.log(os.userInfo())"` fails with `SystemError: uv_os_get_passwd returned ENOMEM (not enough memory)`, while `os.cpus()`, total memory and free-memory reads succeed. This isolates the defect to the Windows/libuv account lookup path, not actual process memory exhaustion and not a Reach assertion.
- The same failure appears inside `tsx`/Hardhat child processes unless the temporary preload is propagated through `NODE_OPTIONS`. With that narrow host workaround, Hardhat loaded the cached compiler and the contract suite passed 40/40; no application source was changed.
- The first browser run's failures were a separate process-lifecycle issue: an old child server remained bound to 8787 after a manual launch, so the browser received failed `/api/register/options`, `/api/auth/confirmation` and related responses. Playwright-managed fresh servers eliminated the condition and passed 77/77. This is a test-host/harness defect, not evidence of an identity or payment regression.
- The workaround files and local servers were removed. No test server remains listening on ports 5173 or 8787.

### Infrastructure inspection and isolation boundary

- Exact financial staging deployment URL: **NONE AVAILABLE**. No isolated financial staging origin has been provisioned, so no deployed passkey registration, return login, provider CAS, two-user isolation or live financial result may be claimed.
- The existing production-named Vercel project `techkeyys-projects/reach` was inspected but not used. Its Preview/Production assignments include shared KV variables, `REACH_FEE_PAYER_PRIVATE_KEY`, production-origin/RP settings, Moderato RPC and vault settings; that is not an acceptable staging boundary. No variables were changed.
- The protected visual-review project `techkeyys-projects/reach-task-007p-visual-review` remains non-financial: SSO protection is enabled and `vercel env ls preview` reports **No Environment Variables found**. Its URL is [the protected visual review](https://reach-task-007p-visual-review-kq9e9x3al-techkeyys-projects.vercel.app), but it is not a financial staging URL and cannot prove deployed passkey or payment outcomes.
- The ignored local `.env.local` contains local KV/RPC/fee-payer values used by the developer environment. It was not copied into a staging project, printed, committed or used to claim provider-level staging proof. No live payment or settlement was intentionally issued.
- Actual provider CAS across staging instances: **OPEN**. Local durable-adapter and concurrency tests are deterministic application proof; a real provider `EVAL`/CAS read-write race has not been observed because the separate staging KV does not exist.
- Server-only agent/MPP secrets, a separate MPP recipient, a stable HTTPS origin/RP ID, Tempo staging RPC/indexer configuration and settlement authority are **OPEN**. No production secret may be reused.

### Required single owner action before financial UAT

Provision one separate non-production HTTPS origin and attach a separate staging/Preview deployment through the authorized secret-management interface with only isolated values: `REACH_ORIGIN`, matching `REACH_RP_ID`, independent durable `KV_REST_API_URL`/`KV_REST_API_TOKEN` with CAS/EVAL, `REACH_AGENT_ENCRYPTION_KEY`, `MPP_SECRET_KEY`, independent `REACH_MPP_RECIPIENT_ADDRESS`, `REACH_MPP_IDENTITY_SECRET`, verified Tempo Moderato `REACH_RPC_URL`/indexer, and—only if payee-side session close is explicitly authorized—`REACH_MPP_SETTLEMENT_PRIVATE_KEY` whose derived address exactly equals `REACH_MPP_RECIPIENT_ADDRESS`. Do not reuse the `reach` project, local fee payer, production KV, payout vault, production origin or production wallet. Return only the staging URL and confirmation that the variables are attached; never paste secret values into chat.

### Task 009 Claim → Mechanism → Boundary → Proof ledger

| Claim | Mechanism | Boundary | Proof / status |
|---|---|---|---|
| Release candidate is unchanged and reviewable | Fixed RC branch and exact SHA | No `main` push or deployment mutation | **PASS**: local/remote `16ce4eb`; clean worktree; `origin/main` unchanged |
| Authentication and identity continuity remain protected | Passkey/WebAuthn flow, owner-bound records, recovery assertions | No client-supplied identity substitution; unknown passkey has no registration fallback | **PASS locally**: 5/5 focused and 77/77 complete browser suite; deployed proof OPEN |
| Agent keys are not browser-held | Server generates signer and encrypts at rest with `REACH_AGENT_ENCRYPTION_KEY`; browser holds only opaque session credential | Durable KV and encryption configuration are required; unconfigured deployment fails closed | **PASS in source/unit proof**; staging secret/CAS proof OPEN |
| MPP payer cannot escape owner-approved policy | Exact origin/recipient/chain/currency/amount/expiry/mode checks plus atomic reservations and reconciliation | Separate recipient; UNKNOWN remains reserved; no automatic retry | **PASS deterministically** in contract/unit/browser coverage; live receipt OPEN |
| Financial evidence is authoritative | Activity, receipts, settlement and reclaim records are reconciled from provider/Tempo authority | Visual preview has no financial env vars; local fixtures are not live evidence | **PASS boundary**; live provider records OPEN |
| Two unrelated users are isolated | Authenticated owner scope on policies, payments, activity and balances | Requires two normal passkey ceremonies on the isolated origin | **OPEN** until owner provisions staging |

### Product journey matrix and UAT gate

| Journey | Local/deterministic evidence | Isolated deployed financial evidence | Status |
|---|---|---|---|
| Fresh passkey account → return login → authoritative balance | 77/77 browser suite; auth/identity tests | No staging origin/RP/KV | **LOCAL PASS / LIVE OPEN** |
| Fund → human send → recipient claim → Activity/balance reconcile → expiry/reclaim | Contract, unit and browser fixtures | No authorized live transaction | **LOCAL PASS / LIVE OPEN** |
| Owner-approved agent → direct MPP → verified receipt → actual service output → financial record | Agent/MPP tests and browser journey | No MPP secret/recipient/staging receipt | **LOCAL PASS / LIVE OPEN** |
| MPP session → multiple metered requests → UNKNOWN recovery → close/settle | Session/reconciliation tests and browser states | No settlement authority or live channel | **LOCAL PASS / LIVE OPEN** |
| Revoke → later spend rejected; refresh/reconnect | Authorization/browser tests | Requires live owner-scoped deployment | **LOCAL PASS / LIVE OPEN** |
| User A vs unrelated User B policies/activity/balances | Deterministic authz negative cases | Requires two fresh staged accounts | **LOCAL PASS / LIVE OPEN** |

### Release recommendation

**Recommendation: keep `RELEASE HOLD`.** The local release candidate is verified and the complete browser gate is green, but Task 009 completion is not met. The exact blocker is owner-controlled isolated staging: stable HTTPS/WebAuthn origin, separate durable KV with observed CAS, server-only MPP/agent secrets, independent recipient/settlement authority and two normal-user ceremonies. After that one provisioning action, run the explicit owner-approved financial UAT path and record real Tempo Moderato receipts separately from deterministic/local evidence. Do not claim Reach is financially finished before those deployed outcomes are observed.

## Task 008-UX — landing-page content restoration (2026-10-10)

### Director decision and release posture

- Release posture: **HOLD**. The public landing page is now a substantial, scrollable product explanation with working FAQ controls; this task does not change financial staging or authorize live transactions.
- Authorized branch remains `codex/reach-task-007-staging-rc`. No push to `main`, production deployment, production secret, owner signature or live financial transaction was performed.
- The old animated application preview was **not** restored. No simulated balance, payout, claim or payment result is rendered on the landing page.
- Reviewed landing implementation commit: `4f80e33` (`feat: restore Reach landing content`), pushed to `origin/codex/reach-task-007-staging-rc`.

### Historical content recovered and restored

The baseline immediately before the Task 005C-UX landing redesign was inspected at `7544dae^:src/client/LandingHero.tsx` (755 lines). Its useful informational copy and section structure were recovered without copying its interactive preview.

| Historical baseline content | Task 008-UX result |
|---|---|
| Hero promise: “Pay people, not wallet addresses.” | Restored as the manifesto and closing CTA while keeping the current passkey-first hero promise and honest testnet disclosure. |
| Manifesto explaining address, network and gas friction | Restored as the dark overview block below the hero. |
| “What Web3 Payouts Get Wrong” / address, claim and expiry cards | Restored as the “Payment infrastructure that starts with the person” section, with copy bounded to the implemented claim/reclaim flow. |
| Four-step Fund / Share / Claim / Settle workflow | Restored as “From passkey to paid result,” updated to cover account, funding, send/approve and verify/recover. |
| Tempo, pathUSD, vault and WebAuthn infrastructure cards | Restored as a disclosed testnet infrastructure section; removed unsupported “audited” language. |
| Standard transfer vs Reach comparison matrix | Replaced with a less repetitive capability narrative covering sender, recipient, team and agent use cases; no unsupported numeric promise was carried forward. |
| Security and non-custodial control section | Restored with visible boundaries for vault lifecycle, private claim capability, payment states and owner-scoped agent authority. |
| Six-item FAQ | Restored and expanded to ten accessible accordion answers covering onboarding, fees, expiry/reclaim, private links, custody, network/token, batch payments, MPP, UNKNOWN recovery and revocation. |
| Closing CTA and multi-column footer | Restored with real Get Started/Open Reach actions, section navigation, GitHub/preview links and testnet release-hold disclosure. |

### Changed screens and functional mapping

- `src/client/LandingHero.tsx` now owns the complete public landing narrative. Primary CTA buttons still call the existing `onStartSend` account gateway action; footer and navigation buttons scroll to real sections; claim links remain on their existing `/c/` route.
- `src/client/styles.css` adds the reusable landing content system: editorial manifesto, responsive content rows, capability cards, four-step flow, agent policy disclosure panel, infrastructure cards, security boundary panel, FAQ accordions, closing CTA and footer.
- `test/browser/task-005c-ux.spec.ts` adds the landing contract for 320/375/390/768/1440 widths, full-page capture, no horizontal overflow, minimum scroll height and keyboard FAQ expansion/collapse.
- `director.md` records this handoff and keeps the prior Task 008 staging evidence intact.

### FAQ coverage and safety boundary

- **Onboarding/passkeys:** recipient can claim with a supported device authenticator; no wallet app, extension or pre-existing address is required.
- **Funding/network:** Tempo Moderato testnet, chain ID 42431, pathUSD and test-funds-only disclosure are explicit.
- **Fees:** recipient-side claim sponsorship is described as a configured relay capability, not an unconditional production guarantee.
- **Recipient claims/recovery:** private bearer-link handling, expiry, Activity and Return funds are described without promising recovery of a lost link.
- **Batch payments:** the existing Send batch flow is referenced without inventing a new path.
- **Agent payments/MPP:** exact policy scope, MPP challenge/receipt verification, actual service response, UNKNOWN/session close and revocation match the implemented authenticated product.
- Every FAQ control is a native keyboard-focusable button with `aria-expanded`, `aria-controls`, a labeled region and deterministic open/close behavior.

### Task 008-UX evidence

These captures are **LOCAL / DETERMINISTIC UI evidence**, not live financial UAT. They contain no production credentials, bearer claim links, private keys, fake balances or fake transaction outcomes.

- Full-page mobile: [320px](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-008-ux-landing-320.png), [375px](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-008-ux-landing-375.png), [390px](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-008-ux-landing-390.png).
- Full-page responsive: [tablet 768px](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-008-ux-landing-768.png), [desktop 1440px](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-008-ux-landing-desktop-full.png).
- Owner visual-review surface: [Reach Task 008-UX protected Preview](https://reach-task-007p-visual-review-kq9e9x3al-techkeyys-projects.vercel.app). Deployment `dpl_3hgXneSdB64CH5CTqtCbNkFmK65R` is `target=preview`, `status=Ready`, and was built from the reviewed landing implementation at `4f80e33`.
- The deployed visual-review project remains SSO-protected with no environment variables. The refreshed Preview is not financial staging: it has no KV, fee payer, agent encryption, MPP, settlement or production credentials.

### Verification results

- `pnpm typecheck` — **PASS**.
- Vite client build — **PASS** (`vite build`, 2,229 modules transformed; existing large-client-chunk warning only).
- Focused browser suite `task-005c-ux.spec.ts` — **3 passed, 0 failed** after the restoration test was added; includes original public/authenticated shell coverage plus the new five-width full-page and keyboard-FAQ proof. The first combined attempt timed out only on an unsupported synthetic Space-key collapse; the test was corrected to Enter and the focused restoration proof then passed **1/1** in 37.2s.
- `pnpm test:unit` — **163 passed, 0 failed, 0 skipped**.
- Contract command `pnpm test` — attempted twice after stopping stale Node preview processes but blocked before Hardhat loaded tests by host `uv_os_get_passwd returned ENOMEM`; this is an environment resource failure, not a test assertion. The same release candidate’s prior Task 008 contract gate remains recorded as **40 passed, 0 failed**; no contract/backend file changed in Task 008-UX.
- `git diff --check` — PASS after the landing changes.
- No financial backend, auth, balance, agent authorization, MPP or contract source was changed.

### Task 008-UX acceptance matrix

| Requirement | Status | Proof / boundary |
|---|---|---|
| Recover useful original copy | PASS | Baseline `7544dae^` inspected; manifesto, problem framing, flow, infrastructure, security, FAQ, CTA and footer restored |
| Remove simulated application preview | PASS | No `.interactive-hero-stage`, sender payout card or fake claim interaction exists in the new component |
| Substantial scrollable landing page | PASS | Five-width full-page screenshots; browser asserts document height > 3000px |
| FAQ keyboard interaction | PASS | Enter opens and closes the first FAQ item; native button semantics and ARIA state are asserted |
| Mobile widths 320/375/390/768 and desktop | PASS | Browser proof and captures at all requested widths; no horizontal overflow |
| Primary Get Started remains real | PASS | Existing `onStartSend` account gateway action is retained for header, hero, capability, agent, CTA and footer actions |
| Financial/authenticated journeys unchanged | PASS | Only public landing component, landing CSS and focused landing browser contract changed |
| Protected visual review updated | OPEN — publish after commit | Existing isolated SSO Preview can be rebuilt from the reviewed branch; no production project or financial env is to be used |

### Task 008-UX recommendation

**Recommendation: approve the landing-page UX for visual review; keep release HOLD.** The landing page now provides the requested informative scroll experience without reviving the old simulated product demo. The existing SSO-protected non-production Preview has been refreshed at deployment `dpl_3hgXneSdB64CH5CTqtCbNkFmK65R` from landing commit `4f80e33`. Financial staging/UAT remains gated by the separate owner provisioning and live two-user acceptance steps documented in Task 008 below.

## Task 008 — final product integration (2026-10-10)

### Director decision and release-candidate state

- Release posture: **HOLD**. The secure visual-review surfaces and repeatable build are complete; independent-user financial staging remains unproven.
- Preserved branch: `codex/reach-task-007-staging-rc`.
- Task 008 started from and verified remote HEAD `636958153c17542896cd5cf76eba5e90e1507c0d` with a clean worktree. The build-policy repair is now pushed at `500b8d43b0a7b34b73f213856225bf5c19184b7e`.
- `origin/main` remains `5c5504227e83a55ee94eac81c4025e93c4874ae6`. No merge, production deploy, production-secret change, owner signature or live financial transaction was performed.

### Owner inspection surfaces

- Application Preview: [Reach Task 008 protected Preview](https://reach-task-007p-visual-review-b05ytsis9-techkeyys-projects.vercel.app).
- Application deployment: `dpl_8Vfd14CqqDiHiKgWqbrM19uFTG9L`; `vercel inspect` reports `target preview`, `status Ready`, and the ordinary dependency install/build completed successfully.
- Screenshot gallery: [Reach Task 008 protected screenshot gallery](https://reach-task-008-screenshot-gallery-274e5yjl9-techkeyys-projects.vercel.app).
- Gallery deployment: `dpl_BBQUBjJggZpXqaNAnEujuJzgVrsH`; `vercel inspect` reports `target preview`, `status Ready`, static output only.
- Both projects report `ssoProtection.deploymentType=all_except_custom_domains`, have no custom domain and no configured environment variables. Unauthenticated `HEAD /` requests return `302` to Vercel SSO with `X-Frame-Options: DENY` and `X-Robots-Tag: noindex`.
- The application Preview contains the real redesigned routes and fail-closed application behavior. Because it has no staging credentials, authenticated financial screens cannot complete a passkey or payment journey there. The gallery contains actual Playwright captures of landing, onboarding, Overview, Send, Activity, Funding, Agents, claims, paid-service output and revocation states so an owner can inspect desktop/mobile UX without developer tools.
- Gallery evidence is explicitly labeled **LOCAL / DETERMINISTIC — NOT LIVE FINANCIAL UAT**. No screenshot contains a production credential, private key or bearer claim link.

### Vercel dependency/install-policy diagnosis and repair

- Failure reproduced on the isolated Preview before Task 008: Vercel CLI `62.7.0` ran pnpm `11.19.0`; the default install failed with `ERR_PNPM_IGNORED_BUILDS` for `esbuild@0.28.2`.
- Root cause: the repository carried the old `onlyBuiltDependencies` setting and `.npmrc` forced `ignore-scripts=true`, while the current pnpm 11 policy uses the explicit `allowBuilds` map.
- Repair: `pnpm-workspace.yaml` now contains only `allowBuilds.esbuild: true` plus `strictDepBuilds: true`; the old `.npmrc` global script suppression was removed. Every dependency build script other than the pinned `esbuild` package remains rejected.
- Local proof: `pnpm install --force` succeeded using pnpm `11.19.0`; `pnpm build:web` succeeded and generated the Vite client plus `api/index.js`.
- Remote proof: a fresh ordinary `vercel deploy --target preview` succeeded without `--dangerously-allow-all-builds`, without a persistent Vercel install override, and without prebuilt output. The Vercel log shows normal `pnpm install`, the lockfile passed supply-chain checks, `pnpm build:web` ran, and deployment became Ready.
- The fix follows pnpm 11's explicit build-allowlist model and Vercel's documented install/build configuration rather than enabling arbitrary dependency scripts.

### Task 008 feature-completion matrix

| Requirement | Status | Evidence / boundary |
|---|---|---|
| Preserve reviewed RC | PASS | Remote branch starts from `6369581`; current pushed RC is `500b8d4`; `main` unchanged |
| Owner can inspect landing and responsive UX | PASS | Protected application Preview plus 18-capture SSO gallery; 375/390/768/1280/1440 evidence |
| Repeatable secure Vercel build | PASS | Normal Preview install/build succeeds with only `esbuild` allowlisted and strict dependency build rejection |
| Fresh independent passkey registration on staging origin | OPEN — owner infrastructure | Local Chromium/WebAuthn proof exists; no stable staging origin/RP ID or owner-approved independent account was available |
| Second independent account and isolation | OPEN — owner UAT | Local owner-scoped isolation tests pass; live two-user staging proof remains required |
| Human payment, claim, history and reclaim | PASS locally / OPEN live | Contract, unit and browser fixtures pass; no authorized live transaction was performed in Task 008 |
| Agent approval, scoped MPP payment and actual service output | PASS locally / OPEN live | Deterministic MPP charge/session proofs and paid-result capture pass; live recipient/signing boundary is unprovisioned |
| MPP session funding, multi-request recovery and settlement | PASS locally / OPEN live | Local session/channel/UNKNOWN/reconcile tests pass; no live channel or settlement authorization exists |
| Revocation and rejected later spend | PASS locally / OPEN live | Local browser and authorization tests pass; live post-revocation payment rejection remains an owner-approved staging gate |

### Claim → Mechanism → Boundary → Proof ledger

| Claim | Mechanism | Boundary | Task 008 proof |
|---|---|---|---|
| Owner can inspect all implemented screens without developer tools | SSO-protected application Preview plus static screenshot gallery | No environment variables, custom domain or public access; gallery is fixture evidence only | Both Preview deployments Ready; unauthenticated probes redirect to SSO; gallery includes 18 actual Playwright captures |
| Preview builds reproducibly without arbitrary install scripts | pnpm 11 `allowBuilds` map with only `esbuild: true` and `strictDepBuilds: true` | Every unlisted dependency script is denied; no `--dangerously-allow-all-builds` is used | Local install/build pass plus fresh ordinary Vercel Preview build pass |
| Financial UAT will not be mistaken for visual proof | Explicit local/deterministic labels and no financial env vars in either review project | No balances, receipts, signer actions or settlement claims from preview/gallery | Director matrix separates local proof from live gates; no live transaction performed |
| Owner-controlled staging will preserve identity and spending boundaries | Separate HTTPS/RP/KV/MPP/Tempo configuration, then normal UI journey | Production project, production KV, fee payer and vault are not reused | Exact owner provisioning gate documented below; current environment intentionally stops before credentials |

### Verification results

- `pnpm install --force` — PASS with pnpm `11.19.0`; strict allowlist accepted only `esbuild`.
- `pnpm typecheck` — PASS.
- `pnpm test:unit` — **163 passed, 0 failed, 0 skipped**.
- `pnpm test` — **40 passed, 0 failed**.
- `pnpm build:web` — PASS; Vite client and API bundle generated.
- `pnpm exec playwright test --workers=1 --reporter=line` — **76 passed, 0 failed**.
- `node scripts/scan-release-secrets.mjs` — PASS; 196 tracked files scanned, `findings=[]` after removal of the obsolete `.npmrc`.
- `git diff --check` — PASS.
- Fresh ordinary Vercel Preview build — PASS; `dpl_8Vfd14CqqDiHiKgWqbrM19uFTG9L`, target `preview`, status `Ready`.
- Static screenshot gallery Preview — PASS; `dpl_BBQUBjJggZpXqaNAnEujuJzgVrsH`, target `preview`, status `Ready`.

### Exact Task 008 changes

- `pnpm-workspace.yaml` — replaced legacy `onlyBuiltDependencies` with the narrow pnpm 11 `allowBuilds` map and `strictDepBuilds: true`.
- `.npmrc` — removed the global `ignore-scripts=true` override so the package-specific allowlist controls the build boundary.
- `director.md` — this Task 008 evidence and owner staging gate.
- External protected gallery artifact — static `index.html` plus copied Playwright captures under the Codex visualization workspace; it is not part of the financial application repository.
- No contract, authentication, balance, payment, agent authorization or settlement source was changed in Task 008.

### Isolated financial staging: exact owner stop

No safe financial staging environment can be completed from the current checkout because the required secret-management and WebAuthn-origin authority are not available, and Task 008 requires separate owner authorization for financial transactions.

**One actionable owner instruction:** provision a separate non-production HTTPS origin and attach a separate Preview/staging deployment to it through the authorized Vercel secret-management interface, with only these server-side values: `REACH_ORIGIN`, matching `REACH_RP_ID`, separate `KV_REST_API_URL`/`KV_REST_API_TOKEN` with CAS/EVAL, `REACH_AGENT_ENCRYPTION_KEY`, `MPP_SECRET_KEY`, `REACH_MPP_RECIPIENT_ADDRESS`, `REACH_MPP_IDENTITY_SECRET`, verified Moderato `REACH_RPC_URL`/indexer and, only if explicitly needed, `REACH_MPP_SETTLEMENT_PRIVATE_KEY` whose derived address equals the MPP recipient. Do not reuse the existing `reach` Preview variables, payout vault, fee payer, production origin or production wallet. Provide only the resulting staging URL and confirmation that the variables are attached; never paste secret values into chat.

After that owner step, the remaining acceptance work is the explicit two-user live walkthrough: fresh passkey A → funding → human payment/claim/reclaim → agent approval → real MPP 402 → signed payment → actual service response → authoritative receipt/balance/activity → refresh/UNKNOWN/session close/settlement → revoke → rejected later spend; then repeat discovery/isolation checks with unrelated user B. No CLI, configuration download, manual API call, preassigned wallet or hidden transaction rescue may be used.

### Task 008 recommendation

**Recommendation: accept the build and visual-review deliverables; keep release HOLD and stop at owner provisioning.** The application can now be deployed reproducibly into a safe visual Preview, and the owner has a protected screenshot gallery for every implemented surface. The completion criterion of safely deployed independent-user financial acceptance is not met until the owner provisions the separate staging boundary and separately authorizes live financial UAT.

## Task 007P — secure visual-review preview and staging preparation (2026-10-10)

### Director decision and exact Git state

- Release posture: **HOLD**. The owner may inspect the redesigned UI, but this preview is not financial UAT.
- Authorized branch: `codex/reach-task-007-staging-rc`.
- The requested pre-change HEAD `070e93702819875fecac1b9410e0624fdba4a084` was verified before the browser-harness repair. The candidate now intentionally advances to `0d5c05e01028a100e37db705d076d7818b378f68` because the repair preserves the identity-continuity assertions while removing two proven timing false negatives.
- The branch was pushed once, explicitly, to `origin/codex/reach-task-007-staging-rc`; remote verification returned `0d5c05e01028a100e37db705d076d7818b378f68`.
- `origin/main` remains `5c5504227e83a55ee94eac81c4025e93c4874ae6`. No merge or push to `main` was performed.
- The Task 007P handoff documentation commit is the only remaining local handoff mutation after the verified branch push; the final exact HEAD is reported with the completed handoff.

### Protected visual-review deployment

- Isolated Vercel project: `techkeyys-projects/reach-task-007p-visual-review`.
- Preview URL: [Reach Task 007P visual review](https://reach-task-007p-visual-review-fawqfbpfe-techkeyys-projects.vercel.app).
- Deployment inspector: [Vercel deployment 5iu1GmXckF6tapVEewCftxRriKig](https://vercel.com/techkeyys-projects/reach-task-007p-visual-review/5iu1GmXckF6tapVEewCftxRriKig).
- Deployment ID: `dpl_5iu1GmXckF6tapVEewCftxRriKig`; `vercel inspect` reports `target preview` and `status Ready`.
- Access method: Vercel team SSO. The project protection readback reports `ssoProtection.deploymentType=all_except_custom_domains`; no custom domain was added.
- Unauthenticated HTTP probe: `HEAD /` returned `302 Found` to the Vercel SSO endpoint with `X-Frame-Options: DENY` and `X-Robots-Tag: noindex`; the visual review is not anonymously exposed or embeddable.
- Isolation proof: `vercel env ls preview` for the isolated project returned **No Environment Variables found**. The build used local prebuilt output; no production or staging secret was uploaded.
- The existing `reach` Vercel project was not used. Its Preview assignment currently includes shared KV credentials, `REACH_FEE_PAYER_PRIVATE_KEY`, production-origin/RP settings, Moderato RPC and vault settings; that is an unsafe financial Preview boundary for this task. Its deployment-protection readback has no SSO protection. No deployment was made there.
- Preview behavior: visual shell and route assets are available; credential-dependent auth, balances, funding, payments, discovery, claims and settlement are intentionally unavailable without configuration and must fail closed. The preview must not be described as a working financial deployment and contains no fabricated live balance or payment result.
- The first full remote build was rejected before deployment by Vercel's dependency-script policy. The final deployment used a locally verified Vercel prebuilt output, leaving `vercel.json` unchanged and avoiding a persistent broad install-script allowance.

### Owner-visible UI evidence

The captures below are **LOCAL / DETERMINISTIC** Playwright evidence from the reviewed implementation. They prove layout, interaction states and the local payment-result journey; they do not claim live Tempo Moderato settlement. The protected URL above is the owner-facing visual inspection surface.

- Landing: [375px](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots/landing-mobile-375x667.png), [390px](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots/landing-mobile-390x844.png), [768px](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots/landing-tablet-768x1024.png), [1440px](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-ux-landing-desktop-1440.png).
- Application shell and navigation: [Overview mobile](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-ux-overview-mobile-390.png), [Overview desktop](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/05-app-desktop-1440.png), [Send mobile](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-ux-send-mobile-390.png), [Activity desktop](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v2/05-activity-desktop.png), [Funding 1280px](/C:/Users/HomePC/Desktop/Reach/artifacts/funding-1280.png), and [recipient claim mobile 390px](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots/claim-mobile-390x844.png).
- Required payment-state evidence: [local paid service result](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-agent-paid-result.png) and [local revoked state](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-agent-revoked.png). These use deterministic/local fixtures and are not live financial receipts.
- Responsive suite covered 375, 390, 430, 768 and 1440 widths. No horizontal-overflow failure was reported. A 1280px funding capture is present; the visual-review URL is the canonical surface for inspecting every route at 1280px.

### Intermittent browser timeout — diagnosis and repair

- The first Task 007P full run failed once in `identity-continuity.spec.ts` at the server-not-committed recovery transition. The case had the default 30-second Playwright budget despite doing a forced transport failure, reload, exact completion retry and normal login. The same assertions passed in isolation.
- Focused evidence after the repair: the identity-continuity file passed **5/5**. The repair adds a 60-second test budget only; it does not skip, remove or weaken any identity, one-ceremony, exact-completion, server-reconciliation or no-fallback assertion.
- The next diagnostic full run exposed a second harness timing problem: after sign-out, the final relaunch had already rendered the authenticated app, but `page.goto(..., waitUntil: "networkidle")` waited on background health/balance work and timed out even with a 60-second diagnostic budget. The trace snapshot showed the live app shell and authenticated address.
- The repair changes only that final recovery navigation to `domcontentloaded`, followed by explicit `Your Reach address` and exact account-address assertions. Focused agent-payment plus app-session verification passed **4/4**; the final complete browser run passed **76/76** with one worker.
- Diagnosis: browser lifecycle timing/resource pressure, not an authentication, identity, payment, balance or authorization regression. The identity-continuity assertions remain active.

### Feature-completion matrix

| Product surface | Local implementation | Protected preview | Live financial staging gate |
|---|---|---|---|
| Landing / Get Started | PASS; concise promise, benefits, testnet disclosure, real gateway action | Visual | Owner reviews copy and mobile hierarchy |
| Overview / authenticated balance | PASS against local deterministic authenticated fixtures and authoritative local route logic | Visual only; no balance credentials | Separate staging origin, KV, RPC and passkey UAT |
| Send / batch / recipient claim links | PASS in local browser and contract coverage; sender recovery and reclaim paths retained | Visual only; financial routes fail closed | Two-user staging send, claim, history and reclaim |
| Activity / receipts / discovery | PASS locally with owner-scoped discovery and financial-state rendering | Visual only | Durable staging records and authoritative receipt checks |
| Funding | PASS locally with testnet-specific guarded route and responsive evidence | Visual only; no faucet or signer config | Staging funding policy and owner testnet UAT |
| Agents / authorization / spending limits | PASS locally; server-held encrypted signer and owner-scoped policy controls | UI visible; approval endpoint unavailable without secrets | Owner approval, exact policy metadata and budget enforcement |
| MPP direct and metered service payments | PASS with deterministic/local MPP tests; actual service output is rendered and persisted in the local journey | Intentionally unavailable without MPP secrets/recipient | Separate recipient, MPP secret, durable KV, receipt and settlement proof |
| Refresh / UNKNOWN / session close / revocation | PASS in local unit/contract/browser coverage; focused recovery and revoke flow pass | Visual recovery states only | Interrupted live payment, UNKNOWN reconciliation, close/settlement, post-revoke rejection |
| Settings / sign-out / session recovery | PASS; focused app-session recovery 4/4 | Visual | Fresh and returning passkey users on staging origin |

### Claim → Mechanism → Boundary → Proof update

| Claim | Mechanism | Boundary | Proof delivered in 007P |
|---|---|---|---|
| Owner can inspect the real redesigned UI without production access | Separate Vercel project, no env vars, SSO deployment protection, Preview target only | Existing production project and its unsafe inherited Preview were not used | Ready deployment inspection plus project protection/env readback |
| Browser recovery does not create a second identity | Same exact WebAuthn completion is retried; identity test timeout is scoped to the recovery work | One-create counter, exact completion and normal-login assertions remain enforced | Identity browser suite 5/5; complete suite 76/76 |
| Sign-out and relaunch prove session closure | Sign-out clears the active shell and relaunch explicitly checks the gateway, then authenticated recovery | Final navigation no longer waits on unrelated network-idle background work | App-session/agent focused suite 4/4; complete suite 76/76 |
| Paid service output is not merely a receipt | Local MPP payer calls the service route, verifies payment, renders response body and records financial state | Live receipt/settlement remains separate until staging secrets and recipient exist | Deterministic agent paid-result capture plus MPP unit/contract evidence |

### Verification results for Task 007P

- `pnpm typecheck` — PASS.
- `pnpm test:unit` — **163 passed, 0 failed, 0 skipped** (existing release-candidate gate).
- `pnpm test` — **40 passed, 0 failed** (contract/agent suite).
- `pnpm check:api-drift` — PASS (existing release-candidate gate).
- `pnpm build:web` — PASS; local Vite client and API bundle generated. The only warning is the existing large-client-chunk warning.
- `pnpm audit --prod --json` — PASS; zero reported vulnerabilities (existing release-candidate gate).
- `node scripts/scan-release-secrets.mjs` — PASS; 197 tracked files scanned, `findings=[]`.
- `git diff --check` — PASS.
- Focused identity continuity — **5 passed**.
- Focused agent-payment/app-session diagnostic — **4 passed**.
- Complete Playwright browser suite — **76 passed, 0 failed**, one worker. This includes onboarding, returning sessions, responsive widths, claims, funding, human/batch send, activity, MPP service output, refresh, session recovery, UNKNOWN/retry coverage and revocation.

### Exact Task 007P changed files

- `test/browser/identity-continuity.spec.ts` — scoped recovery timeout aligned with the already-proven WebAuthn recovery workload.
- `test/browser/app-session.spec.ts` — final sign-out/relaunch navigation waits for DOM readiness and retains explicit authenticated-state assertions.
- `director.md` — this handoff, preview isolation evidence, timeout diagnosis, completion matrix and staging gates.
- No application financial/backend source file was changed in Task 007P. `vercel.json` remains unchanged after the failed broad-install-policy experiment; the final Preview used local prebuilt output.

### Financial staging provisioning: shortest supported path

| Requirement | Can be completed without owner intervention | Owner / authorized infrastructure action |
|---|---|---|
| Stable HTTPS origin and WebAuthn | Code and config validation only | Create a dedicated non-production hostname; set `REACH_ORIGIN` to that exact origin and `REACH_RP_ID` to its hostname; perform the first passkey registration on that origin |
| Durable KV with CAS | Local adapter/tests and deployment wiring can be prepared | Provision a separate staging KV; provide `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or supported Upstash names); verify `EVAL`/CAS and no production namespace sharing |
| Agent encryption | Secret schema and fail-closed checks are implemented | Generate a server-only random 32-byte `REACH_AGENT_ENCRYPTION_KEY` encoded as hex/base64url; never place it in Vite/client variables |
| MPP payee configuration | Route and deterministic tests are complete | Provision `MPP_SECRET_KEY`, a separate authorized `REACH_MPP_RECIPIENT_ADDRESS`, and the service recipient relationship; do not use the payout vault as the service recipient |
| Session recovery identity | Code is complete and locally tested | Provision server-only `REACH_MPP_IDENTITY_SECRET` for multi-worker recovery; no browser/session URL exposure |
| Settlement authorization | Optional code path is complete and gated | If payee-side close settlement is required, provision `REACH_MPP_SETTLEMENT_PRIVATE_KEY`; its derived address must exactly equal the MPP recipient. This is a financial authority and needs owner approval, custody and rotation |
| Tempo Moderato | Public RPC/chain constants are already pinned and tested | Configure and verify staging `REACH_RPC_URL`/indexer against chain `42431`; provision only separate staging funds/recipients and perform live transactions only after explicit UAT approval |
| Two-user UAT | Test harness and isolation assertions are ready | Owner supplies two unrelated passkeys/accounts and approves the real payment, receipt, UNKNOWN, close, refresh and revoke walkthrough |

The shortest safe staging path is therefore: owner provisions the separate HTTPS/RP/KV/MPP secret boundary; the implementation can then wire and verify health/fail-closed behavior; the owner performs two-user passkey and financial UAT. No CLI, configuration download, manual API call, preassigned wallet, production secret, owner signature or live transaction was used for this Task 007P preview.

### Next acceptance gate and recommendation

**Recommendation: approve visual review; keep release HOLD.** The owner can inspect the actual redesigned Reach pages online through the protected Preview, while financial behavior remains intentionally disabled there. Do not call this financial staging or production UAT. The next gate is a separately provisioned staging deployment at the pushed RC (or a documented follow-up commit) and one complete two-user walkthrough: fresh passkey → overview/balance → funding → owner-approved agent → paid service body → authoritative MPP receipt/settlement → financial record after refresh/reconnect → UNKNOWN/interrupted-session reconciliation → revoke → rejected subsequent spend.

## Task 007 — final integration and staging acceptance (2026-10-10)

> Historical pre-007P snapshot. The authorized push, protected visual Preview and browser-harness repairs are recorded in the Task 007P section above; do not use the older `no push/deployment` lines below as the current state.

### Current release decision

- Release posture: **HOLD**.
- Local implementation branch: `codex/reach-task-007-staging-rc`.
- Production baseline audited: `5c5504227e83a55ee94eac81c4025e93c4874ae6` (`fix: secure testnet funding abuse limits`).
- Local release candidate commit: `7544daeb4ed5f3b488461031fd29104feb3eed7a` (`feat: prepare Reach Task 007 staging candidate`); no push, deployment, production-secret provisioning, owner signature, or new live financial transaction was performed.
- Staging status: **BLOCKED at provisioning boundary**. This checkout has no separate staging origin/RP configuration, no `REACH_AGENT_ENCRYPTION_KEY`, no `MPP_SECRET_KEY`, no `REACH_MPP_RECIPIENT_ADDRESS`, no `REACH_MPP_IDENTITY_SECRET`, and no staging deployment target. Existing local KV/RPC/funding material was not repurposed as staging authorization.

### Audit matrix — production baseline versus Task 005C/005C-UX diff

| Boundary | Audit result | Evidence |
|---|---|---|
| Contract and deployment surface | PASS | `git diff 5c550422.. --name-only` contains no `contracts/`, `deploy/`, `deployments/`, or Hardhat configuration changes. Contract suite remains unchanged and passes 40/40. |
| Authentication and identity tests | PASS | Modified browser specs only update landing CTA labels/selectors; existing account-gateway, origin, credential continuity, retry, mismatch, and no-fallback assertions remain. Changed tests contain no skip/fixme markers. |
| Agent signer custody | PASS locally | `src/server/agentAuthorization.ts` generates the delegated signer server-side, encrypts it with AES-256-GCM, stores only the hash of the bearer credential, and removes secret fields from public policy responses. No agent private-key import exists under `src/client/`; the only client-side private-key code is the pre-existing claim bearer capability. |
| Authorization boundary | PASS locally | Owner session binds policy creation/list/read/revoke to the authenticated owner; activation verifies root account, signed access-key scope, chain, expiry, cumulative limit, non-admin status, exact recipient/selectors, and onchain metadata. MPP direct and session purposes are disjoint from vault payout purpose. |
| Payment accounting | PASS locally | Durable CAS reservations, idempotency, `CONFIRMED`/`FAILED`/`UNKNOWN` states, authoritative receipt/payout reconciliation, owner-scoped discovery, and revocation paths are covered by unit, contract, and browser evidence. |
| API artifact drift | PASS | `pnpm check:api-drift` reports the tracked `api/index.js` matches `src/server/serverlessHandler.ts`. |
| Secrets and credential storage | PASS | `node scripts/scan-release-secrets.mjs` scanned 187 tracked files with zero findings. A worktree pattern scan found no private-key PEM, literal operator key, or bearer claim URL. Secret values were not printed. |
| Dependencies | PASS | `pnpm audit --prod --json`: 0 info, low, moderate, high, or critical vulnerabilities across 120 resolved dependencies. Installed versions: `mppx 0.13.4`, `ox 0.14.45`, `viem 2.57.1`. |

### Claim → Mechanism → Boundary → Proof ledger

| Claim | Mechanism | Boundary | Local proof | Live/staging proof |
|---|---|---|---|---|
| A fresh user can enter Reach with a passkey and recover an interrupted registration | Accounts WebAuthn ceremony plus short-lived IndexedDB pending completion record; retry never creates a second passkey | Server credential record and same public key remain authoritative; stale/mismatched credentials fail closed | Full Playwright rerun 76/76; isolated server-not-committed recovery case passes; 163 unit tests | **OPEN:** fresh human passkey on approved staging origin |
| An owner can approve a least-privilege agent from the normal UI | Agents screen creates policy, invokes `wallet_authorizeAccessKey`, activates only after server signature/onchain checks | Owner address, chain 42431, expiry, budget, selectors, destination and origin are exact | `agentAuthorization.test.ts`, browser agent journey, `mppLocal.test.ts` | **OPEN:** live owner approval and metadata reread |
| A paid service request returns actual service output and a financial record | UI calls `/api/mpp/payer/request` or `/api/mpp/payer/session`; MPPx verifies the challenge/receipt; response body is persisted and rendered | Server-held private signer; browser receives only opaque session bearer; payer strips caller payment headers and blocks redirects/unapproved origins | Deterministic charge and session tests; browser service-result/financial-record/revoke evidence | **OPEN:** separate staging MPP recipient, receipt, service body, settlement |
| Refresh/reconnect and UNKNOWN states are recoverable | Durable owner/policy/payment indexes, idempotency records, session channel store, direct receipt reference, reconcile endpoints | UNKNOWN remains reserved and cannot be retried blindly; only authoritative Tempo receipt releases budget | Unit tests cover unknown direct/MPP states; browser refresh/revocation journey | **OPEN:** interrupted live session and UNKNOWN reconciliation |
| Revocation prevents subsequent agent spending | Owner-only revoke updates policy; every bearer operation authenticates current ACTIVE policy; UI clears session token and requests owner access-key revoke | Revocation and spending are server/onchain boundaries, not a success-toast state | Authorization tests and browser revoked-state evidence | **OPEN:** live post-revocation rejected payment |
| Two unrelated users cannot see each other's agent records | Policy indexes are keyed by normalized owner; every read route checks authenticated session owner | No client-supplied owner address is trusted for policy/payment discovery | Cross-owner isolation test in `agentAuthorization.test.ts` | **OPEN:** two independent staging passkey accounts |

### Verification results

- `pnpm typecheck` — PASS.
- `pnpm test:unit` — **163 passed, 0 failed, 0 skipped**.
- `pnpm test` — **40 passing, 0 failing** (Hardhat contract and agent access-key suite).
- `pnpm check:api-drift` — PASS.
- `pnpm build:web` — PASS; Vite emitted only the existing large-client-chunk warning; API bundle generated successfully.
- `pnpm audit --prod --json` — PASS; zero vulnerabilities.
- `git diff --check` — PASS.
- Playwright first complete run — 75 passed, 1 failed: one suite-level 30-second timeout in the server-not-committed identity continuity case. The same case passed in isolation.
- Playwright focused recovery rerun — PASS.
- Playwright fresh complete rerun — **76 passed, 0 failed** in 7.7 minutes, one worker. Covered desktop/mobile UI, 375/390/430/768/1440 widths, onboarding, login failures, recovery, funding, claims, activity, agent/MPP UI, refresh and revocation.

### Required browser evidence already delivered locally

- [Landing desktop screenshot](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-ux-landing-desktop-1440.png)
- [Landing mobile screenshot](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-ux-landing-mobile-390.png)
- [Overview mobile screenshot](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-ux-overview-mobile-390.png)
- [Send mobile screenshot](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-ux-send-mobile-390.png)
- [Agent paid-result screenshot](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-agent-paid-result.png)
- [Agent revoked screenshot](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-agent-revoked.png)

These are deterministic/local UI and MPP evidence. They do not prove live Tempo Moderato settlement, live staging durability, real owner approval on a staging origin, or two independent live users.

### Staging gate and owner actions

Staging deployment was not attempted. To open the next gate, the owner must provision a separate non-production origin and RP ID, durable KV with CAS/EVAL support, server-only `REACH_AGENT_ENCRYPTION_KEY`, MPPx `MPP_SECRET_KEY`, a separate `REACH_MPP_RECIPIENT_ADDRESS` and matching optional settlement signer, explicit Moderato RPC/chain `42431`, and a service recipient/signing relationship. The owner must then approve the non-production branch push/deployment and perform all financial signatures/transactions explicitly. No production alias, production main, existing local fee-payer key, or existing wallet was used as a substitute.

### Task 007 review recommendation

**PASS for the local release candidate; HOLD for staging/live acceptance.** The implementation and test evidence are complete for local review. The exact next acceptance gate is a fresh two-user staging walkthrough: passkey onboarding → authenticated overview/funding → owner-approved agent → paid service output → authoritative MPP receipt/settlement → financial record after refresh/reconnect → UNKNOWN/interrupted-session reconciliation → revoke → rejected subsequent spend. A release recommendation must remain HOLD until that staging evidence is captured against the deployed revision and the full suite is rerun against that exact deployment.

### Task 007 exact Git state recorded after the implementation commit

```text
branch: codex/reach-task-007-staging-rc
implementation commit: 7544daeb4ed5f3b488461031fd29104feb3eed7a
working tree: clean
remote push: not performed
staging deployment: not performed
```

## Current cold-start funding handoff (2026-09-27)

Account funding: local validation complete; production deployment and owner UAT are separate gates. Phase 3 remains UAT READY. Phase 4 remains reported INTEGRATION PROVEN / UAT READY CANDIDATE, not UAT PASS; the current reconstruction does not elevate that report.

See [testnet account funding evidence](docs/testnet-account-funding.md) for the authoritative one-call faucet result, repository reconstruction, public-only persistence, address-binding limitations, and release blockers. The live primitive added exactly 1,000,000 pathUSD to a fresh throwaway public address; it did not create a payout or prove normal financial UAT.

Five pre-existing emptied proof/test files and the untracked two-call faucet probe are preserved. Historical sections below contain older architecture/status claims and must not override the current reconstruction or be treated as fresh proof.

## P0 identity continuity — SDK-native recovery

Recorded: 2026-09-29

Branch: `ui/reach-onboarding`
Implementation status: local fix complete; not merged and not deployed.
Financial status: no payout, funding, claim, reclaim, faucet, or recipient transaction was performed for this work.

### Identity authority and derivation

- Reach continues to use the maintained `accounts@0.18.4` WebAuthn adapter and its durable server credential records (`credential:<credentialId>`); no Reach users table, wallet mapping, or custom identity protocol was added.
- `Account.fromWebAuthnP256({ id, publicKey }, { rpId })` delegates address derivation to the P-256 public key. The root Tempo address is determined by `publicKey`; `credentialId` is retained for later authenticator signing but changing only the credential ID does not change the derived address. A different public key derives a different address.
- The Accounts browser snapshot is a durable IndexedDB cache/provider state (`tempo`); it is not the identity authority. The server credential record and a fresh WebAuthn login are the recovery boundary. The SDK's HTTP session is separate and expires after 24 hours.
- Localhost keeps RP ID `localhost`; production keeps RP ID `reach-seven-lemon.vercel.app`. They are separate WebAuthn credential namespaces and are not bridged.

### Partial registration handling

- `PASSKEY_CREATED_SETUP_INCOMPLETE` stores the exact serialized registration completion payload in a separate local IndexedDB namespace (`reach.identity`) when the passkey ceremony succeeds but completion does not return successfully. `Finish setup` retries that payload and never calls `navigator.credentials.create()` again.
- The recovery path distinguishes `PASSKEY_CREATED_SERVER_NOT_COMMITTED` (same completion payload can still be accepted while its challenge remains valid) from `SERVER_COMMITTED_CLIENT_NOT_PERSISTED` (the SDK credential record is already present; the client reconciles the exact public-key record and then performs a normal login to prove authenticator possession).
- The Accounts handler's actual ordering is: verify the registration response; atomically create `credential:<credentialId>`; run `onRegister`; delete the challenge; issue the session. If persistence or the hook fails, the handler deletes the credential and challenge. A successful response can therefore lose its transport after the credential commit; the new read-only reconciliation route handles that case without issuing a session or mutating KV.
- If the browser closes after Case A while the server never stored the credential and the serialized response/challenge are gone, current WebAuthn/Accounts primitives cannot recover the public key from the passkey alone. Reach must not silently create another identity.
- Multiple-passkey linking to an existing Tempo account was not found in the maintained Accounts/AccountKeychain path and was not implemented: `MULTIPLE PASSKEY RECOVERY: PLANNED / UNPROVEN`.

### Claim → mechanism → proof ledger

| Claim | Mechanism | Authoritative boundary | Required proof | Current proof | Status |
| --- | --- | --- | --- | --- | --- |
| Reach remembers my account | Accounts SDK IndexedDB snapshot remembers the current provider state; the durable Accounts KV credential record remains the identity authority | Tempo `Account.fromWebAuthnP256` plus the Accounts server credential record | Reconnect after browser state loss and derive the same address | Local Chromium/WebAuthn integration deleted the SDK snapshot, preserved the authenticator, and reconstructed the same public account; production/hardware remain separate gates | PASS — localhost integration |
| Signing in restores the same account | Login verifies the durable credential, then the SDK reconstructs the account from its public key | WebAuthn verification and Tempo account derivation, not client storage | Registration → fresh client/process → login yields the original address and session | Real browser registration, cookie loss, fresh login, and same-address equality pass; separate app instances share the exact Accounts record | PASS — localhost integration |
| Clearing browser app data does not create a new account | IndexedDB is only a cache; login uses the server credential and the authenticator | Durable `credential:<credentialId>` record and `Account.fromWebAuthnP256` | Remove provider snapshot, sign in with the same passkey, compare addresses | Chromium test deletes `tempo.store` and `tempo.lastCredentialId`, then signs in with the preserved authenticator and derives the same address | PASS — localhost integration |
| Failed account setup cannot silently create duplicates | Pending completion retries the same payload; committed-record reconciliation requires an exact public-key match and then a normal login; unknown credentials remain rejected by the SDK handler | Accounts credential store plus WebAuthn possession proof | Transport failure, duplicate completion, unknown credential, and serverless request separation all preserve one identity | Five real-browser scenarios pass; exact-record tests pass across separate app instances; one `navigator.credentials.create()` ceremony is enforced in retry cases | PASS — localhost integration |

### Final integration gate — localhost browser proof

Recorded: 2026-09-29

The required integration gate now passes against the running local app and API using Playwright Chromium's CDP virtual authenticator (`ctap2`, resident key, user verification, automatic presence simulation). This is a real browser WebAuthn ceremony, not a fixture-only account response. The test origin and RP ID are both `localhost`; production remains separately configured as `reach-seven-lemon.vercel.app` and was not changed.

- Registration created a public Tempo account, then the test deleted the Accounts SDK IndexedDB snapshot keys (`tempo.store`, `tempo.lastCredentialId`) and cleared the session cookie while preserving the virtual authenticator. A normal sign-in reconstructed the same public account address.
- The final full-suite run derived public account `0xfD152Fea9Dc363A78eB65cCda279954600D92252`; the post-loss login response derived the same address. This is public test evidence only; no private key, credential private material, bearer capability, or financial transaction was involved.
- Lost response after server commit: the upstream registration committed with HTTP 200, the browser saw the transport failure, the pending state survived reload, exact completion retry returned HTTP 400 for the consumed challenge, `/auth/register/reconcile` returned HTTP 200 `already_committed`, and normal login returned HTTP 200 for the same account. The browser create counter remained exactly 1 and the pending record was removed after recovery.
- Server-not-committed response: the first completion returned HTTP 503, Finish setup retried the exact serialized completion once, normal login succeeded, the account was created once, and the pending record was removed.
- Unknown credential: a passkey created while registration was deliberately not committed was rejected by login with HTTP 400. No registration fallback occurred and the browser create counter remained exactly 1.
- Expired pending state: a record older than the five-minute TTL was removed on read and did not trigger registration or a retry loop. Fresh records carry explicit `createdAt` and `expiresAt`; the timer is best-effort while every read enforces the TTL.
- Storage remains origin-local SDK IndexedDB (`tempo` database, `store` object store, key `reach.identity.pendingRegistration`) and contains only the serialized registration completion response needed for the short retry window. It is not a Reach identity database and is never the identity authority. Successful recovery and Start over clear it.
- Server separation: reconciliation was verified across two separately constructed app instances sharing the Accounts KV authority. No custom Reach identity table or account mapping was introduced.

Integration commands and results:

- `node node_modules/typescript/bin/tsc --noEmit` — PASS
- `node node_modules/tsx/dist/cli.mjs --test test/authFlow.test.ts test/claimLink.test.ts test/payoutDiscovery.test.ts test/serverApp.test.ts test/claimRecovery.test.ts test/testnetFunding.test.ts` — 49 passed
- `node node_modules/@playwright/test/cli.js test test/browser/identity-continuity.spec.ts --workers=1` — 5 passed
- full local browser suite — 49 passed, 5 skipped (the five fixture-only funding tests are intentionally skipped when `TARGET_URL` is set)
- Vite production build and API bundle — PASS

No financial, faucet, deployment, or production authentication mutation was performed for this gate. Hardware authenticator behavior and production-origin recovery remain separate release/UAT gates; the mandated local browser-style integration is proven.

## Deployment — GitHub + Vercel Single-Origin Production

Recorded: 2026-09-25

- Repository: `https://github.com/Techkeyy/Reach` (private repository under authenticated GitHub account `Techkeyy`).
- Branch: `main` (clean commit history preserved, no secrets tracked).
- Deployed Commit SHA: `84ec8de`
- Stable Production Hostname: `reach-seven-lemon.vercel.app`
- Production Origin: `https://reach-seven-lemon.vercel.app`
- WebAuthn RP ID: `reach-seven-lemon.vercel.app`
- WebAuthn RP Name: `reach-seven-lemon.vercel.app`
- WebAuthn Algorithm: `ES256` (`-7`)

### Architecture & Routing

Single stable HTTPS origin:
- Frontend root: `https://reach-seven-lemon.vercel.app/`
- SPA direct claim link navigation: `https://reach-seven-lemon.vercel.app/c/<payoutId>` (configured in `vercel.json` rewrites, returns 200 index.html)
- Same-origin API endpoints:
  - `GET /health` -> `{"ok":true,"chainId":42431,"sponsorConfigured":true}`
  - `GET /api/payout/:id` -> Authoritative onchain payout data
  - `GET /api/payouts/:sender` -> Authoritative discovered sender payouts
  - `GET /api/balance/:address` -> Authoritative pathUSD balance
  - `POST /auth/*` -> Passkey WebAuthn options negotiation & registration
  - `POST /relay/*` -> Narrow recipient claim sponsorship only

### WebAuthn Serverless State

The installed SDK `accounts@0.18.4` uses `Handler.webAuthn` with a key-value store for:
1. `challenge:<hex>` (short-lived challenge negotiation)
2. `credential:<credentialId>` (registered credential public key & user ID)
3. `session:<token>` (user session tokens)

Durable REST KV Adapter (`src/server/kvAdapter.ts`) connects to `KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL` with graceful fallback to `Kv.memory()`.

### Deployed Smoke Test Results (Read-Only)

All 10 automated smoke checks passed on `https://reach-seven-lemon.vercel.app`:
1. `GET /` -> HTTP 200 (HTML) [PASS]
2. `GET /c/1790060937954` -> HTTP 200 (HTML, no 404) [PASS]
3. `GET /health` -> HTTP 200 (`ok: true`, `chainId: 42431`, `sponsorConfigured: true`) [PASS]
4. `GET /api/payout/1790060937954` -> HTTP 200 (`status: 2 (CLAIMED)`, `amount: 1000000`, `sender: 0x3DF6...`) [PASS]
5. `GET /api/payouts/0xAF75774194AbeEC3A0D86693d8A7bC1139311061` -> HTTP 200 (2 payouts found) [PASS]
6. `GET /api/balance/0xAF75774194AbeEC3A0D86693d8A7bC1139311061` -> HTTP 200 (`847369` base units) [PASS]
7. `POST /auth/register/options` -> HTTP 200 (`rp.id: reach-seven-lemon.vercel.app`, `alg: -7`) [PASS]
8. `POST /auth/login/options` -> HTTP 200 (`rpId: reach-seven-lemon.vercel.app`) [PASS]
9. `POST /auth/register/options` with untrusted origin -> HTTP 403 Forbidden [PASS]
10. `POST /relay` with arbitrary transaction -> Rejected (no arbitrary transaction execution) [PASS]

No new payout, funding transaction, claim transaction, or human passkey ceremony was performed. Phase 3 financial UAT remains gated.

## Phase 3 restart-recovery fix — public payout discovery

Recorded: 2026-09-24

The lost bearer capability remains an accepted limitation once it is genuinely unavailable, such as after a browser or PC restart, on another device, or after session storage is cleared. It stays ephemeral in tab-scoped session storage and is never moved into localStorage, durable IndexedDB, cookies, URLs, a server database, public metadata, or logs. Reach cannot recreate a lost claim link. Leaving the Batch success screen alone does not lose a capability that is still present in the current browser session.

The sender dashboard recovery blocker is fixed at the public-lifecycle layer. On sender connection, the server queries the maintained Tempo testnet tidx indexer for the connected sender’s indexed PayoutCreated events, decodes the raw topics/data to preserve exact 256-bit payout IDs and amounts, and rereads every discovered payout from the deployed ReachPayoutVault before returning it to the browser. The browser merges those authoritative records with any session-local notes/evidence; the local cache is not treated as lifecycle truth.

The new public endpoint is GET /api/payouts/<sender>. It returns only payout ID, sender, amount, expiry, claim signer, claimant, status, creation metadata, and recoverable funding transaction evidence. A funded payout is rendered separately from bearer availability: Funded can coexist with a sender-local `Copy claim link` action when the capability is present, or with `Private claim link is unavailable on this device.` when it is not. Public discovery never fabricates a capability.

The sender can therefore reconnect after tab close, browser close, PC restart, or cleared session storage, rediscover old payouts without manually entering IDs, reread status/expiry/claimant, and use the existing sender-only reclaim path after expiry. While the sender-local capability remains available, Activity → payout detail can recover and copy the exact compact claim link for an unexpired FUNDED payout. This exact lost-capability 0.05 pathUSD payout remains reserved for the real reclaim UAT and was not touched by this fix.

## Batch claim-link recovery — local release candidate

Recorded: 2026-10-08

Local commit: `aa145ee3232eaf138aa093c0daa72b2a3469ae4f` (`fix: recover batch claim links from activity`)

The batch success screen is no longer the only sender interface for batch links. Batch funding already persists each bearer in the existing sender-only session capability store before the provider call and persists public payout metadata before submission. The local fix now preserves non-secret batch metadata through sender discovery and exposes each still-available link from the normal Activity → payout detail path.

The `Copy claim link` action is available only when all of these conditions hold:

- the authoritative payout is `FUNDED`;
- authoritative chain time proves it is not expired;
- the connected Reach account matches the onchain sender; and
- the sender-local capability validates successfully.

Claimed, reclaimed, and expired payouts do not expose a claim action. If public payout metadata is present but the capability is unavailable on the current device/session, the UI says `Private claim link is unavailable on this device.` and never fabricates or rotates a capability. The private capability is not stored in sender public metadata, activity responses, server storage, logs, or API artifacts.

Local proof completed: 22/22 focused batch/lifecycle tests, 50/50 targeted sender/activity/claim tests, 147/147 existing unit tests, the focused browser Activity → payout detail → Copy claim link regression, TypeScript, web build, API build, API drift check, and `git diff --check` all pass. No payout, claim, reclaim, email, deployment, or blockchain mutation was performed for this candidate.

Promotion status: `NOT PUSHED / NOT DEPLOYED`. `origin/main` remains `f74e2a132dc45c0e73bd6c2a332e8c093027ba8`; the local candidate is one commit ahead and requires director approval before promotion or production UAT.

### Claim → mechanism → proof ledger update

| Claim | Mechanism | Boundary | Required proof |
| --- | --- | --- | --- |
| Sender can return later and manage funded payouts | Authoritative sender payout discovery from Tempo indexed PayoutCreated events, followed by deployed-vault rereads | Public discovery = application/indexing layer; lifecycle truth = hard authoritative contract state | Full browser/PC restart, reconnect sender, and old funded payout reappears without manual payout ID entry |
| Sender can recover an unclaimed batch link after leaving success | Batch capability remains in the sender-only session store; Activity → payout detail reconstructs the compact URL only for the connected sender with an unexpired authoritative FUNDED payout | Capability remains client-only; sender ownership and chain lifecycle remain authoritative gates | Local unit and browser regression: Activity → payout detail → exact Copy claim link; different-device absence remains honest and non-fabricating |
| Lost claim credential does not lose principal | Bearer remains ephemeral; principal stays in the vault until recipient claim or sender-only reclaim after expiry | Hard enforced by the vault state machine | This exact lost-capability payout remains FUNDED through expiry and is reclaimed by the original sender through normal UI |

## Phase 3 UAT blocker — sender balance presentation

Recorded: 2026-09-23

The owner’s connected Tempo passkey account is `0xAF75774194AbeEC3A0D86693d8A7bC1139311061`. The authoritative Moderato read at block `36575337` returned `1,000,000` base units for pathUSD (`1.000000` pathUSD) from token `0x20c0000000000000000000000000000000000000`. No payout, approval, account creation, or transaction was performed for this investigation.

The sender balance boundary was proven: the browser request is `GET /api/balance/<address>` through the Vite proxy to the local Hono relay. With the relay stopped, the proxy returned HTTP `502` and the previous client catch path reset the value to `null`, while the rendered `null` state remained `Checking…`. The existing relay was restarted; `/health` is `HTTP 200` with `ok=true`, `chainId=42431`, and `sponsorConfigured=true`, and the browser-origin balance request now returns `HTTP 200` with the exact string balance `1000000`.

The sender UI now has an explicit `LOADING → READY` or `ERROR` state machine. `ERROR` renders `We couldn't read your Tempo balance.` with `Retry`; no fallback balance is used. Review and Sign & fund are disabled unless the authoritative balance is `READY`, the handler repeats the guard, and requested base units must be less than or equal to the exact onchain balance. Malformed responses and HTTP failures are safe errors, with development-only `BALANCE_READ` diagnostics containing only stage, HTTP status, and a safe error label.

The earlier balance-presentation blocker is resolved. Phase 3 is now in human sender UAT: the owner completed one real sender funding flow, and the authoritative funding evidence is recorded below. The recipient claim proof for that payout is invalidated because the bearer link was exposed in a screenshot. The app and relay remain running for the next gated step.

This is a factual handoff. Phase 2 has passed a real passkey-backed recipient claim for payout `1790060937954`; the authoritative onchain claim, recipient-balance, vault-accounting, fee-sponsorship, and terminal-refresh evidence remains recorded below. Phase 3 now adds the normal browser sender lifecycle on the existing vault. The owner-created payout below is valid sender-funding evidence; no operator-created replacement payout or claim was performed in this implementation turn.

## Phase 3 pre-phase financial cleanup

The three abandoned, expired, FUNDED Phase 2 UAT payouts were reread from Tempo Moderato before cleanup at block `36528670` (timestamp `1790150125`). All three had sender `0x3DF635253f3E0835a4723b93801f5d22461914A5`, amount `1,000,000` micro-pathUSD, zero claimant, status `FUNDED`, and an expiry earlier than the authoritative block timestamp. Reclaim was authorized only for this testnet cleanup and used the existing sender-only contract rule.

- `1790055969075` → reclaim transaction `0xaaa0e47e2ef0540857682f68aed33b624040d6a4a16e6eabe76db49370275d95`; receipt succeeded; final status `RECLAIMED` (`3`); final claimant zero; vault/`totalFundedAmount` after reclaim `2,000,000`.
- `1790058214461` → reclaim transaction `0x522a7c2261a71a138d8b40382a8cefe73cf522cd64d869a004c0fba9dfc92cef`; receipt succeeded; final status `RECLAIMED` (`3`); final claimant zero; vault/`totalFundedAmount` after reclaim `1,000,000`.
- `1790059395103` → reclaim transaction `0x9a0b570b129196dc339d7ac05a707c6852c962132bf5f51875afcfecdd5f662a`; receipt succeeded; final status `RECLAIMED` (`3`); final claimant zero; vault/`totalFundedAmount` after reclaim `0`.

The successfully claimed artifact `1790060937954` was reread as `CLAIMED` (`2`) with claimant `0xAF75774194AbeEC3A0D86693d8A7bC1139311061` and was not touched. Final cleanup accounting is exact: Reach vault pathUSD balance `0` and `totalFundedAmount = 0`. No private key or bearer capability is recorded here.

## Phase 3 sender product contract

The normal sender journey is now:

`ROOT → TEMPO PASSKEY ACCOUNT → REAL pathUSD BALANCE → EXACT AMOUNT + EXPIRY → LOCAL CAPABILITY → REVIEW → PREFLIGHTING → READY_TO_SIGN → SIGNING → SUBMITTED → CONFIRMING → FUNDED / FAILED_RETRYABLE / RECOVERY_REQUIRED → CLAIM LINK → PUBLIC DASHBOARD → EXPIRED RECLAIM`

The sender signs directly from their own Tempo WebAuthn account. The browser sends an atomic Tempo call batch containing `pathUSD.approve(ReachPayoutVault, amount)` followed by `ReachPayoutVault.createPayout(payoutId, amount, claimSigner, expiresAt)`. The contract remains the Phase 1 vault; it was not redeployed or redesigned. The sender reclaim UI sends only `ReachPayoutVault.reclaim(payoutId)` after the authoritative state is `FUNDED`, expiry has passed, and the connected sender matches the payout sender.

## Phase 2 objective

The intended recipient path is:

`FUNDED PAYOUT → COLD CLAIM LINK → NEW PASSKEY ACCOUNT → ZERO-GAS CLAIM → REAL TOKEN BALANCE → CONFIRMED CLAIMED STATE`

The code has a real mobile-first route at `/c/<payoutId>#<claimCapability>` and a separate root sender dashboard. The recipient route remains a consumer claim route, not a disposable demo page.

## Current implementation

- Frontend: Vite `8.3.0`, React `19.3.0`, React DOM `19.3.0`, Wagmi `3.7.7`, Viem `2.56.8`.
- Maintained Tempo account SDK: `accounts@0.18.4`; the package exposes the maintained `accounts/server` entrypoint used by this app.
- Server: Hono `4.13.8` with `@hono/node-server@2.1.1`; local process entry is `src/server-entry.ts`.
- Browser proof: `@playwright/test@1.63.0`, Chromium installed by Playwright.
- Supporting tools: TypeScript `7.0.2`, TSX `4.23.15`, Vite React plugin `6.1.1`, Concurrently `10.0.5`.
- Official sources reviewed before integration: [Tempo Accounts SDK](https://github.com/tempoxyz/accounts), [current WebAuthn example](https://github.com/tempoxyz/accounts/tree/main/examples/webauthn), [current fee-payer + WebAuthn example](https://github.com/tempoxyz/accounts/tree/main/examples/fee-payer-and-webauthn), and the published [accounts package](https://www.npmjs.com/package/accounts).

The current official example shape is used directly: `webAuthn({ testnet: true, authUrl: '/auth', feePayer: '/relay' })` in the browser and `Handler.relay({ feePayer: { account } })` plus `Handler.webAuthn(...)` on the server. The archived `tempoxyz/tempo-ts` integration is not used.

## Sender account, principal, and fee policy

`src/client/SenderDashboard.tsx` uses the maintained Wagmi Tempo `webAuthn` connector with `capabilities: { method: 'register', name: 'Reach sender' }`. It displays the connected public address and reads the actual pathUSD balance from `GET /api/balance/<address>`. No fake balance or server-owned sender account is used.

The sender transaction request explicitly sets `feePayer: false`. This opts the transaction out of the globally configured claim fee-payer URL while preserving the recipient claim connector configuration. The sender’s own Tempo account is therefore the transaction principal and uses the normal account fee path. Reclaim uses the same direct sender path. The server has no sender transaction endpoint and never signs `createPayout`, `approve`, or `reclaim` for the normal product flow. `TEMPO_DEPLOYER_PRIVATE_KEY` remains test/deployment infrastructure only.

The `/relay` service remains recipient-claim-only. `validateClaimForSponsorship` still accepts only one zero-value claim call to the configured vault and rejects `createPayout`, `reclaim`, arbitrary token transfers, arbitrary calls, arbitrary batches, wrong chains, native value, and user-selected fee payers. Sender sponsorship was not added.

## Sender dashboard and lifecycle source of truth

The root route is `src/client/SenderDashboard.tsx`. It is intentionally small:

- account creation/connection through the existing Tempo passkey connector;
- exact decimal amount entry with a six-decimal pathUSD boundary;
- optional local-only note and a fixed one-hour, 24-hour, or three-day expiry choice;
- review screen before signing;
- truthful `REVIEW`, `PREFLIGHTING`, `READY_TO_SIGN`, `SIGNING`, `SUBMITTED`, `CONFIRMING`, `FUNDED`, `FAILED_RETRYABLE`, and `RECOVERY_REQUIRED` states;
- funded state shows `Claim link ready` with the bearer fragment masked by default; `Copy claim link` passes the exact URL in memory, while `Reveal link` and `Hide link` are explicit controls;
- claim link release only after `/api/payout/<id>` returns the expected `FUNDED` record with the sender and derived `claimSigner` matching;
- public lifecycle dashboard discovers sender-owned payout IDs from `/api/payouts/<sender>`, rereads each payout from `/api/payout/<id>`, and does not require a bearer capability;
- sender-only `Reclaim` action for `FUNDED + expired` records.

The session index in `src/client/senderStorage.ts` stores only public data: payout ID, amount, expiry, claim signer, batch group metadata, recipient name, memo, transaction evidence, and created time. It never stores the bearer capability. The capability remains in the dedicated sender-only session store. On refresh or navigation, the dashboard can show public lifecycle state from the index and authoritative API reread and, when the capability is still present, reconstruct the exact claim link from Activity/payout detail. A genuinely lost claim link is not regenerated; the sender sees an honest unavailable state and can reclaim after expiry.

## Phase 3 fee-aware funding acceptance ledger

The sender remains on the direct fee path. No sender sponsorship was added and the claim-only relay boundary was not widened.

| Claim | Mechanism | Boundary | Required proof |
| --- | --- | --- | --- |
| Sender cannot knowingly submit an unaffordable payout through normal Reach UI | Exact Tempo `eth_fillTransaction` preflight of the real `approve + createPayout` batch before signing, with the real sender, chain `42431`, WebAuthn key type, and `feePayer: false` | SOFT ENFORCED — client/product transaction-construction boundary; not a protocol-level guarantee | Full-balance adversarial preflight fails with decoded `TokenTransferFailed()` before signing/submission; affordable `100,000` micro-pathUSD fill succeeds. No gas-math estimate is invented. |
| Reach only calls a payout `FUNDED` after principal actually settles in the vault | Successful transaction receipt plus authoritative vault reread matching payout ID, sender, exact amount, claimSigner, expiry, and status `FUNDED` | HARD source of truth = deployed contract state; UI enforcement = SOFT presentation layer | Real exact-match `FUNDED` resolution, with receipt-success mismatch entering `RECOVERY_REQUIRED`; A–J regression proof covers both. |
| Failed sender transaction is represented truthfully | Receipt-status branch plus authoritative payout read; reverted receipt becomes `FAILED_RETRYABLE`, unknown/mismatched state becomes `RECOVERY_REQUIRED` | SOFT ENFORCED application state | Known reverted transaction reconstructs `FAILED`, not `CONFIRMING`/`FUNDED`, with no claim link; evidence hash is retained and capability cleared. |

Known live sender artifact cleanup: payout `66734098054632377628940790133593306730712900761504354019136738427919374359704` has authoritative vault state `NONE`; its evidence transaction is `0x586af4b7fd831bac54590a213a7afd1aaabf8b06266edda472110d701a49c6ca` with reverted receipt. It is not reclaimable and no new claim capability is generated. On refresh, the sender dashboard reconciles this public record as `FAILED` and preserves the evidence hash while clearing the stored capability. The sender’s current authoritative balance is `998,814` micro-pathUSD (`0.998814` pathUSD), read through `/api/balance` at Moderato block `36674587`; it is not restored, faked, or used to submit a new payout in this implementation turn.

## Phase 3 live UAT — funded payout evidence and bearer exposure

Recorded: 2026-09-24

The owner completed the real sender passkey signing flow for exactly one `0.10` pathUSD payout. The funding outcome is valid sender-flow evidence, but the full claim URL was displayed in a screenshot, so the payout's bearer capability is compromised and is disallowed for recipient proof.

- Payout ID: `55596398158796912738519836714353507070181302874783804146314302142802913996845`.
- Principal: `100,000` micro-pathUSD (`0.10` pathUSD).
- Sender: `0xAF75774194AbeEC3A0D86693d8A7bC1139311061`.
- Funding transaction: `0x31c8ef7ac752f9663baa4852c98cdec45971aaf393dedb69116f784be93194c7`.
- Receipt: success (`status = 1`), block `36,677,520` (`0x22fa790`), transaction type `0x76`.
- Fee payer: the sender above; fee token: PathUSD `0x20c0000000000000000000000000000000000000`.
- Exact network fee: `817` micro-pathUSD (`0.000817` pathUSD), derived from the sender balance delta (`998,814` before the funding block to `897,997` currently, less the `100,000` principal). The receipt's `fee` field was null; no gas-math estimate is substituted.
- Authoritative payout reread: `FUNDED` (`status = 1`), claimant zero address, amount `100,000`, claim signer `0x9e2505836b9389bb94fa19a272fc11e9c4ca3e4e`, expiry `1790325760`.
- Vault accounting: PathUSD balance `100,000` micro-pathUSD and `totalFundedAmount = 100,000` micro-pathUSD.
- Sender balance after funding: `897,997` micro-pathUSD (`0.897997` pathUSD).

This payout is `LEVEL 4 REAL OUTCOME — PASS` for the sender-created funding component. The recipient claim proof from this payout is invalidated by bearer exposure. Do not use, copy, regenerate, or claim with that capability. If the payout remains funded after expiry, reclaim it through the sender-only expiry path.

An accessible local Chrome-session storage scan found no `reach.claim.<payoutId>` key value. The active owner browser tab was not available through the browser control session, so active-tab clearance cannot be independently asserted. Clearing local storage would not revoke an already exposed bearer; this payout remains disallowed for recipient UAT.

## Claim → mechanism → proof security ledger

| Claim | Mechanism | Proof boundary | Limitation |
| --- | --- | --- | --- |
| A claim link is a bearer credential | A 32-byte capability is encoded in the URL fragment; its derived signer is committed in the payout onchain | HARD ENFORCED by the vault's signature verification and stored `claimSigner` check | Confidentiality is SOFT and user-opsec dependent; anyone holding a disclosed link can claim while funded |
| A disclosed capability can be rotated or revoked before expiry | Not implemented | No protocol or product revocation/rotation boundary exists before expiry | Do not call the link recoverable, revocable, private, or recipient-bound; reclaim is only available to the sender after expiry |

The sender UX now keeps the funded link masked by default, supports explicit reveal/hide, copies only on explicit user action, warns that anyone with the link can claim, and does not place the capability in public payout metadata, analytics, logs, request URLs, or QR output.

## Claim capability boundary

Link format:

`http://localhost:5173/c/<decimalPayoutId>#<43-character-base64url-encoding-of-32-random-bytes>`

The fragment is the bearer capability. It is generated in `src/client/claimCapability.ts` with `crypto.getRandomValues`, and its local secp256k1 address is the exact `claimSigner` passed to `createPayout`. The capability is never sent to analytics, logs, query parameters, cookies, blockchain calldata, transaction memo, director.md, Git, or console output. The sender link is assembled only in memory after authoritative funding confirmation.

The fragment is retained only in the active browser/session path necessary for the claim flow (`sessionStorage['reach.claim.<payoutId>']`); `localStorage` is not used. Public sender dashboard storage contains no capability. Recipient boot removes the fragment from the address bar before the claim UI proceeds, reads the real onchain payout through `GET /api/payout/<payoutId>`, and refuses to render a claim CTA unless the locally derived signer equals the stored onchain signer.

The two signatures remain separate:

- bearer claim key: client-only EIP-712 authorization for `Claim(payoutId, recipient, action, version)`;
- Tempo passkey account: sender or recipient account authorization for submitting the vault transaction.

The claim key is not the Tempo account, and the passkey is not the bearer capability.

## Recipient account and passkey architecture

The only browser connector is the maintained Tempo `webAuthn` connector from `wagmi/tempo`. Injected wallets and MetaMask are disabled with `multiInjectedProviderDiscovery: false`. There is no pre-imported conventional wallet and no hidden manually generated recipient wallet.

The first claim uses `capabilities: { method: 'register', name: 'Reach recipient' }`; a returning user uses the existing supported passkey session. The official handler owns the WebAuthn ceremony and account initialization path. Browser copy names device-native choices: fingerprint, Face ID, Windows Hello, PIN, or another supported passkey.

Configured development RP/origin:

- origin: `http://localhost:5173`
- RP ID: `localhost`
- WebAuthn endpoint: same-origin `/auth`, proxied to the local Hono server

This is stable for local development only. No owned production HTTPS hostname or deploy credential was available, so a production passkey proof has not been fabricated. Production uses explicit `REACH_ORIGIN` and `REACH_RP_ID`; they are not hardcoded to an unowned domain.

## Sponsored claim boundary

`/relay` is a narrow Reach sponsor boundary around the maintained `Handler.relay` API. The server-only key is `REACH_FEE_PAYER_PRIVATE_KEY`; it is not a `NEXT_PUBLIC_*` variable, browser storage value, response field, Git file, or client bundle value. It is absent from `.env.example` and must be supplied only to the server process.

Before the official relay can sponsor a fill, Reach validates and simulates:

- chain ID exactly `42431` (Tempo Moderato);
- exactly one call;
- exact current vault target `0x98262c02746f3b91342249159deeebe87a54266c`;
- exact `claim(uint256,address,bytes)` selector;
- zero native value and no authorization list or arbitrary top-level data;
- recipient encoded in the claim equals the Tempo transaction sender;
- payout exists, is `FUNDED`, and is not expired at the latest block timestamp;
- EIP-712 claim signature recovers to the payout’s stored `claimSigner`;
- `simulateContract` succeeds before fee sponsorship.

The guard rejects `createPayout`, `reclaim`, arbitrary token transfers, arbitrary contract calls, arbitrary batches, wrong chain, user-selected fee payer, and native value. The vault protects payout principal; concurrent valid fills can still waste sponsor fees, which is an open abuse/retry concern rather than a reason to widen the sponsor.

Local server health reports `sponsorConfigured: true` from the locked local UAT environment. The relay path is implemented and typed, and the completed UAT receipt below proves a real sponsored transaction.

## Authoritative status flow

The sender frontend never sets `FUNDED` from a click, passkey prompt, or transaction hash. It first calls `eth_fillTransaction` with the exact sender, chain `42431`, WebAuthn key type, `feePayer: false`, and the real `approve + createPayout` batch. A failed fill blocks passkey signing and submission. After a hash it waits for the receipt, treats `status = 0` as `FAILED_RETRYABLE`, and only shows `FUNDED` plus the claim link after receipt success and an exact authoritative `/api/payout/<payoutId>` reread. A successful receipt with missing or mismatched vault state becomes `RECOVERY_REQUIRED`; failed public artifacts retain the evidence hash and clear the capability. Reclaim likewise waits for an authoritative `RECLAIMED` status.

The recipient frontend never sets `CLAIMED` from a click, a passkey prompt, a relay response, or an optimistic transaction hash. After `useSendTransactionSync`, it rereads `/api/payout/<payoutId>` and only shows `CLAIMED` when the vault returns `status = 2`. `RECLAIMED`, `EXPIRED`, `ALREADY CLAIMED`, retryable RPC failure, and unknown state are distinct UI states. A pending recipient/transaction hash prevents blind duplicate action after refresh; the page checks the payout again instead.

## Automated proof

Commands and observed results:

```text
pnpm typecheck       -> success
pnpm build:web       -> success; 2,160 modules transformed
pnpm test            -> 25 passing (25 nodejs) — Phase 1 vault suite
pnpm exec tsx --test test/senderFlow.test.ts test/senderClaimLink.test.ts -> 26 passing (26 nodejs), including required A–J fee/preflight/receipt/recovery regressions and funded-link masking/copy/reveal checks
pnpm test:phase2     -> 12 passing (12 nodejs), including sender restart-recovery discovery and lifecycle tests
pnpm test:browser    -> 8 passed — Playwright Chromium
```

The browser sentinel test remains `test/browser/claim-link.spec.ts`. It observes every generated request and asserts the sentinel capability is absent from request URLs, headers, bodies, the post-redaction URL, DOM, and console text. It also proves missing-fragment, mismatched-signer, and authoritative claimed-state behavior, including same-tab capability clearing. The browser harness now uses `http://localhost:5173`, matching the proven WebAuthn RP boundary; no human UAT interaction was performed.

Phase 3 node tests cover secure capability generation and signer derivation, positive payout IDs, exact decimal conversion, invalid amounts, exact approve/create calldata, exact fee-aware fill requests, full-balance preflight rejection before signing, affordable READY_TO_SIGN, receipt-reverted failure, receipt-success state mismatch recovery, exact FUNDED resolution, failed-artifact/capability cleanup, sender-only reclaim boundaries, claimed/reclaimed terminal states, a refreshable public sender index that contains no bearer capability, and the funded sender-link default-mask, exact-copy, explicit-reveal, hide, and no-public-leak checks.

## Live and manual evidence state

Phase 1 live contract evidence remains valid and is recorded in `docs/moderato-live-evidence.md`; this phase does not reopen the vault design. A real Phase 2 human passkey claim, sponsored receipt, exact recipient transfer, and terminal refresh/revisit behavior are proven below.

Manual UAT has been executed for payout `1790060937954`. The owner completed the device passkey ceremony, the app reached its `Claimed` state, the chain reread returned `status = 2`, the receipt proved the configured Reach fee payer sponsored the transaction, and a direct fragment-free revisit plus refresh remained terminal `CLAIMED` without a Claim button or mutation request.

Phase 3 manual sender UAT is in progress. The owner completed the sender passkey signing flow and produced the funded payout evidence recorded above. The owner also exposed the full bearer URL in a screenshot, so recipient proof from that payout is invalidated. A fresh recipient UAT payout is gated on the sender UX fix being exercised without exposing the link.

## Gate status

- Gates 1–3: PASS for the Phase 1 vault core and live Moderato integration.
- Gate 4 — walletless recipient/passkey: PASS for the Phase 2 UAT. The owner completed a real cold-session passkey ceremony and the resulting recipient account is the onchain transaction sender.
- Gate 5 — sponsored zero-gas claim: PASS for the Phase 2 UAT. The confirmed receipt names the configured Reach sponsor as `feePayer` while the recipient account is the transaction sender.
- Gate 6 — authoritative state/reconciliation: PASS for the Phase 2 UAT. The onchain reread is `CLAIMED`, duplicate claim is prevented, the fragment-free revisit and refresh remain terminal, and no bearer material is required for recovery.
- Gate 7: KILL FOR V1; recipient-selected settlement remains removed.
- Gate 8: DEFERRED; MPP is not in the build.
- Phase 3 sender flow: UAT READY — restart recovery implementation/tests complete; sender funding evidence PASS; human restart/reclaim UAT remains required; recipient claim proof for payout `55596398158796912738519836714353507070181302874783804146314302142802913996845` invalidated by bearer exposure.

If a sender passkey, direct fee path, authoritative funding reread, recipient claim, or reclaim fails during UAT, stop. Do not silently require MetaMask, a conventional wallet, a faucet, or a server-owned sender key.

## Open concerns and next gates

Open concerns are the stable production HTTPS/RP origin, durable WebAuthn/session storage instead of `Kv.memory()`, real sponsor-key custody/rotation/fee balance monitoring, event replay and indexer reconciliation, retry/unknown-receipt handling, and the documented possibility of sponsor-fee waste from concurrent valid fills. Public sender discovery now uses the maintained Tempo indexer plus authoritative vault rereads; local notes and bearer capabilities remain intentionally sender-local. Batch claim-link recovery is locally validated but not yet promoted or exercised in production UAT.

The next gate is director review and promotion of the batch recovery candidate, followed by owner UAT of Activity → payout detail → Copy claim link without exposing the capability. If the compromised payout remains funded after expiry, reclaim it through the sender-only path. Do not begin unrelated API monetization, MPP, mainnet, or marketing work before this recovery path and the remaining money-path UAT are proven.

## Phase 2 Human UAT — post-claim evidence

Recorded: 2026-09-23

Human result:
- The owner opened payout 1790060937954, completed a real passkey ceremony, and reached the app’s “Claimed” state.
- No conventional wallet or user-funded gas was used.

### Authoritative payout and transfer

- Chain: Tempo Moderato, chain ID 42431.
- Payout ID: `1790060937954`.
- Final status: `CLAIMED` (`status = 2`).
- Sender: `0x3DF635253f3E0835a4723b93801f5d22461914A5`.
- Recipient/passkey account: `0xAF75774194AbeEC3A0D86693d8A7bC1139311061`.
- Amount: `1` pathUSD (`1,000,000` micro-pathUSD).
- Claim signer: `0xD2A9F2717802aA07F749d9C4b86947afaca96559`.
- Expires at: `1790147340`.
- `PayoutClaimed` event: transaction `0x27ed61eef321032f9bfe60272353cae56eb6aac382989df6f43b212f95c37066`, block `36446266`, log index `5`, recipient above, amount `1,000,000`, with the payout memo.
- Matching `TransferWithMemo`: the same transaction, block `36446266`, log index `4`, from the Reach vault `0x98262c02746f3b91342249159deeebe87a54266c` to the recipient above, amount `1,000,000`.
- Recipient pathUSD balance: `0` at block `36446265`, `1,000,000` at claim block `36446266`, and `1,000,000` currently; the exact increase is `1,000,000`.

### Fee sponsorship

- Claim transaction: `0x27ed61eef321032f9bfe60272353cae56eb6aac382989df6f43b212f95c37066`.
- Transaction sender (`from`): recipient/passkey account `0xAF75774194AbeEC3A0D86693d8A7bC1139311061`.
- Receipt target: Reach vault `0x98262c02746f3b91342249159deeebe87a54266c`.
- Receipt `feePayer`: `0xf625e1F9117d2c7DB2a74862Da3Be141a1195921`, matching the configured Reach sponsor.
- Transaction type: `0x76`; chain ID `42431`; fee token `0x20c0000000000000000000000000000000000000`; receipt status `1`; gas used `590081`; effective gas price raw `15921514725`.
- The receipt proves sponsor payment for the claim transaction; the recipient did not need to fund gas.

### Vault accounting

- Before-claim baseline: vault pathUSD balance and `totalFundedAmount` were `4,000,000`.
- After claim: both read `3,000,000`.
- The difference is exactly `1,000,000`; the remaining `3,000,000` correspond to other abandoned `FUNDED` payouts before the later authorized cleanup above.

### Refresh/revisit recovery

- Direct fragment-free revisit at `/c/1790060937954`: `CLAIMED`; no claim button.
- Browser refresh of that exact fragment-free page: `CLAIMED`; no claim button.
- Both reads used only the public payout state. No WebAuthn call, relay request, non-GET request, or transaction occurred. The spent capability remains deleted and is not needed for terminal recovery.

## Phase 2B.1 — Live human UAT prepared

Preparation date: 2026-09-22

This was a prepared UAT state, not a Phase 2 pass. The owner performed the later cold browser/passkey interaction. No claim button was clicked and no recipient passkey was created by the operator.

### Fresh Moderato operator accounts

- Test sender public address: `0x3DF635253f3e0835a4723b93801f5d22461914A5`
- Test fee-payer public address: `0xf625e1F9117d2c7DB2a74862Da3Be141a1195921`
- Both accounts were freshly generated with `viem/accounts`, used only for this Moderato test, funded through the official `tempo_fundAddress` RPC, and verified on chain `42431`.
- Both accounts held `1,000,000,000,000` pathUSD base units. The corresponding testnet fee balance was also present.
- The private values were stored only in the locked local operator file and are not recorded here.

### Fresh payout

- Payout ID: `1790055969075`
- Amount: `1` pathUSD (`1,000,000` base units)
- Sender: `0x3DF635253f3e0835a4723b93801f5d22461914A5`
- Claim signer: `0x21927cA72266b42611e731423dc6D560f8ea1cc6`
- Expires at: `1790142370`
- Funding transaction: `0xcc45af89452ca5edf0061471b8c814d73a61fe1ccdba21451b00dfcaecf7fcc2`
- Historical current reread: `FUNDED` (`status = 1`), claimant zero, and not expired at preparation time.
- Redacted claim URL: `http://127.0.0.1:5173/c/1790055969075#[REDACTED]`
- The owner later confirmed that no full claim URL was present in the Windows clipboard; this payout was abandoned and later reclaimed after expiry under the cleanup record above. The capability remains intentionally absent from this record, chat, logs, screenshots, and Git.

### UAT environment

- Relay health during UAT: `{"ok":true,"chainId":42431,"sponsorConfigured":true}`
- Historical owner app URL: `http://127.0.0.1:5173/`
- Historical API/relay URL: `http://127.0.0.1:8787/`
- The actual claim route returned HTTP 200 for the fresh payout.

## Phase 2B UAT correction — replacement capability unavailable

Recorded: 2026-09-22

The owner confirmed that the Windows clipboard did not contain the claim URL for payout `1790055969075`. That payout was left untouched until expiry and later reclaimed by the authorized cleanup above.

One replacement payout was attempted exactly once. Its creation reached chain before the clipboard wrapper stopped on a PowerShell stderr-handling error, so its bearer capability was unavailable and it was left untouched until expiry and later reclaimed by the authorized cleanup above:

- Payout ID: `1790058214461`
- Amount: `1` pathUSD (`1,000,000` base units)
- Expires at: `1790144616`
- Funding transaction: `0xcf1da3bfcd7444eb6f464db43f3897aed437727daf347ed9bd98900b72094da7`
- Claim signer: `0x38E8dA19137247143F1CFf27Ce937dC7000df6D8`
- Historical reread: `FUNDED` (`status = 1`), claimant zero.
- Clipboard verification: failed; no Reach claim URL was present.
- No human claim, passkey ceremony, direct contract call, or script claim was performed.

## Phase 2B.2 — Capability delivery correction

Recorded: 2026-09-22

- Resolved operator environment path: `C:\Users\HomePC\Desktop\Reach\.env.local`
- The misplaced sibling file was moved away and removed; `.env.local` is Git-ignored.
- The claim-link flow performed a non-secret clipboard preflight, created the capability before any chain transaction, sent the full URL to the native clipboard helper through stdin rather than command-line arguments, verified the URL and claim signer before funding, and neutralized the clipboard on failure.
- The in-process sentinel and real-link checks passed, but an independent owner-session clipboard read returned empty. Native `clip.exe` also failed the independent sentinel readback. The Windows computer-use helper was unavailable after two initialization attempts. Therefore owner-visible clipboard delivery was not proven in that execution context.
- The later Phase 2B.3 handoff switched local UAT transport to the temporary Git-ignored `.uat/` file, and the owner confirmed the non-secret sentinel there.

The one replacement payout created during this correction was treated as abandoned because its capability could not be delivered safely and was later reclaimed by the cleanup record above:

- Payout ID: `1790059395103`
- Amount: `1` pathUSD (`1,000,000` base units)
- Expires at: `1790145796`
- Funding transaction: `0xa2a1db13c76a416b2852f29d43371ab052e5eaa20084d6c0ca3c55801dd855b6`
- Claim signer: `0x9f84296a7A4eF0d934AC21Cb2dB5525c8aF3ab2f`
- Historical reread: `FUNDED` (`status = 1`), claimant zero.
- The bearer capability was not recorded anywhere.
- No human claim, passkey ceremony, direct contract call, or script claim was performed.

Payouts `1790055969075`, `1790058214461`, and `1790059395103` were reclaimed only after their respective expiries with the real transaction hashes recorded in the Phase 3 pre-phase cleanup section. The claimed payout `1790060937954` was not touched.

## Task 005C — normal agent payment journey

Recorded: 2026-10-10

This is a new 005C implementation and evidence record. It does not treat the previous 005B report as completion evidence.

### Feature-completion matrix

| Feature | Mechanism | Boundary | Deterministic/local proof | Live Tempo Moderato gate | Status |
|---|---|---|---|---|---|
| Fresh account and owner session | Existing passkey account/session flow; Agents screen receives the authenticated owner address | Owner session is required for every discovery and mutation route | Existing app session suite plus Task 005C browser route fixture | Fresh human passkey onboarding and funded balance reread | UI path connected; live gate remains |
| Funding | Existing Reach funding screen and balance reread | Owner balance is not treated as agent authority | Existing funding/balance tests; Agents screen displays current owner balance | Fresh funded user balance on 42431 | Existing feature; not reopened |
| Owner-approved MPP agent | `POST /api/agent/authorizations` with purpose, exact recipient, exact origin, budget, expiry; passkey `wallet_authorizeAccessKey`; server activation verifies signature and onchain policy | No broad calls; MPP direct/session scopes are distinct; signer material remains encrypted server-side | `test/agentAuthorization.test.ts` owner-approval and scope tests; UI browser journey | Real passkey approval plus access-key metadata reread on 42431 | Implemented locally; live gate remains |
| User-facing payment action | Agents screen sends `/api/mpp/payer/request` or `/api/mpp/payer/session` with the browser-held session credential | Payer still enforces the approved purpose, budget, destination and origin | Playwright button journey; MPPx local direct/session tests | Live Tempo payment without preassigned wallet | Implemented locally; live gate remains |
| Actual service output | Payee response body is returned by the payer and rendered as `Actual service output` | Output is only shown after an authoritative MPP receipt and successful response status | Browser proof renders `{ ok: true, service: Reach agent service, output: actual paid result }`; `mpp.test.ts` payee output | Real paid endpoint response from the configured service | Implemented locally; live gate remains |
| Authenticated financial discovery | Durable owner policy index and per-policy payout/MPP indexes; `GET /api/agent/authorizations` and `GET /api/agent/authorizations/:id/payments` | Index reads are owner-bound and return no signer secret, token hash, key authorization or private key | Two-owner route isolation test; payment index assertion; browser financial record | Durable deployment/indexer audit and live receipt | Implemented locally; live gate remains |
| Spending and settlement states | UI displays spent, reserved, remaining, CONFIRMED, FAILED and UNKNOWN; UNKNOWN has a reconcile action | UNKNOWN is not retried automatically; reconciliation requires authoritative receipt | Agent authorization UNKNOWN/reconcile tests and existing MPP local tests | Live uncertain/recovery exercise | Implemented locally; live gate remains |
| Refresh and reconnect | Session credential is kept only in `sessionStorage`; policy and payment records reread on load, focus and visibility recovery | Lost browser credential is shown as a reconnect/revoke state; UI never fabricates payment capability | Browser reload assertion and recovery copy; local state tests | Human refresh, browser reconnect and session loss | Implemented locally; live gate remains |
| Session close | MPP session close button calls `/api/mpp/payer/session/close` and renders closed state | Session mode only; signer authorization and origin remain bounded | Existing deterministic MPP session open/meter/close proof plus UI control | Live session close settlement | Implemented locally; live gate remains |
| Revocation | Server authorization is closed first, then the connected owner wallet revokes the access key | A failed wallet ceremony cannot leave the server bearer usable; no CLI or config export | Browser revocation fixture and backend revoke tests | Human passkey revocation and failed/interrupted ceremony recovery | Implemented locally; live gate remains |
| Two unrelated users | Owner index keyed by normalized owner address; route checks session owner for policy and ledger reads | User A cannot list or read User B's policy/payment ledger | Seven authorization tests pass, including authenticated route isolation | Two independent human accounts on live deployment | Implemented locally; live gate remains |

### Claim → Mechanism → Boundary → Proof ledger

| Claim | Mechanism | Boundary | Proof |
|---|---|---|---|
| The normal user can request an agent payment from Reach | Agents UI calls the authenticated payer route | No CLI, downloaded config, manual API call or preassigned wallet is needed | `test/browser/agent-mpp-journey.spec.ts` clicks `Pay for service` |
| The user receives a real paid service result | MPPx payer verifies the payee challenge/receipt, then returns the payee body | `mppConfirm` rejects missing/non-Tempo/unsuccessful receipts and non-2xx bodies | Browser service output screenshot plus `test/mpp.test.ts` |
| Financial history is visible after refresh | Owner policy and MPP indexes are reread from KV | Session-authenticated owner equality check; cross-owner route returns 404 | `test/agentAuthorization.test.ts`; browser reload shows `ui-005c-proof` and `CONFIRMED` |
| A payment cannot silently disappear into an uncertain state | MPP payer stores UNKNOWN and exposes reconcile; no automatic retry | Reconcile accepts only authoritative Tempo receipt | Existing UNKNOWN test plus UI `Reconcile authoritative state` control |
| Session use can be ended | Session close calls MPPx manager close and clears channel state | Only MPP session purpose can use the close path | Existing deterministic local session proof and UI control |
| Revocation stops future agent use | Server revoke precedes wallet access-key revoke | Bearer token is cleared from sessionStorage and server status becomes REVOKED | Browser revocation screenshot and revoke unit coverage |

### Task 005C infrastructure automated results — historical snapshot

The following is the earlier local/deterministic infrastructure snapshot recorded before the 005C-UX browser contract and responsive-shell pass. It does not claim a live Tempo Moderato transaction. The current UX-inclusive result is recorded below under `Task 005C-UX verification`.

```text
pnpm typecheck                                      -> PASS
pnpm exec tsx --test test/agentAuthorization.test.ts -> 7 passing
pnpm test:unit                                      -> 163 passing
pnpm test                                            -> 40 passing
pnpm build:web                                       -> PASS; Vite warning only for a large bundle
pnpm check:api-drift                                 -> PASS; tracked api/index.js matches source
git diff --check                                     -> PASS
pnpm exec playwright test test/browser/agent-mpp-journey.spec.ts --workers=1 --reporter=line
                                                     -> 1 passing; 2 Task 005C screenshots captured
pnpm test:browser                                    -> 72 passing, 2 pre-existing browser timeouts in the 74-test suite
isolated account-onboarding fixture rerun             -> PASS (slow: 2.5 minutes)
isolated identity-continuity retry rerun              -> FAIL; same existing 30-second context-close timeout
```

Evidence files:

- `artifacts/screenshots-v3/task-005c-agent-paid-result.png` — authenticated Agents page with paid service output, receipt reference, and financial record.
- `artifacts/screenshots-v3/task-005c-agent-revoked.png` — same journey after refresh and owner authorization revocation.
- `test/browser/agent-mpp-journey.spec.ts` — UI route fixture proves payment action, actual body rendering, refresh recovery and revocation state.
- `test/agentAuthorization.test.ts` — owner discovery, payment index and two-user isolation proof.
- `test/mppLocal.test.ts` — deterministic MPPx Tempo direct and session settlement proof.

### Evidence classification and exact outstanding gates

Deterministic/local evidence: the browser journey uses a local Playwright route fixture for the UI boundary, and the MPPx unit tests use deterministic transports. This proves the product flow, response rendering, owner isolation and state transitions without sending live money.

Live Tempo Moderato evidence: no new live transaction, access-key signature, production secret, deployment or Git push was performed for Task 005C. The live gates are a fresh human passkey account, owner funding, owner access-key approval, direct or session payment to a configured MPP recipient, authoritative receipt/reference reread, service output, refresh/reconnect, UNKNOWN/interrupted-session recovery, two unrelated live users, and passkey access-key revocation.

Exact remaining gates: configure an approved staging MPP recipient and service endpoint; execute the end-to-end live Moderato UAT with explicit approval; capture the authoritative transaction/receipt and service response; repeat with two unrelated funded users; exercise interruption and UNKNOWN recovery; then rerun the full regression suite and critical boundary audit against the exact deployment state. No production deployment or live financial transaction was authorized or attempted here.

### Exact Git status at Task 005C evidence capture

```text
 M .env.example
 M README.md
 M api/index.js
 M package.json
 M pnpm-lock.yaml
 M scripts/agent-payout.ts
 M src/client/AutomationExperience.tsx
 M src/client/SenderDashboard.tsx
 M director.md
 M src/server/app.ts
 M src/server/kvAdapter.ts
?? docs/task-005-agent-infra-ledger.md
?? src/server/agentAuthorization.ts
?? src/server/mpp.ts
?? src/server/mppPayer.ts
?? test/agentAuthorization.test.ts
?? test/browser/agent-mpp-journey.spec.ts
?? test/mpp.test.ts
?? test/mppLocal.test.ts

## Task 005C-UX — mobile-first Reach product shell

Recorded: 2026-10-10

This section records the local UX completion pass for Task 005C-UX. It is separate from the previous 005B report and preserves the existing authenticated payment, claim, funding, agent and MPP boundaries.

### Design decisions and changed screens

- Replaced the public animated product preview with a static Reach landing page: one concise product promise, three concrete benefits, an honest passkey CTA, testnet disclosure, claim-link continuity and proof-oriented security language. There is no simulated payout or fake application state on the landing page.
- Reorganized the authenticated shell around the requested six areas: Overview, Send, Activity, Agents, Funding and Settings. Batch payments remain a real workflow reachable from Send, without competing with the primary navigation.
- Reworked the overview balance card to give the authenticated balance, Tempo network, refresh action, funding action and Send action a clear hierarchy. Existing payout/activity data remains the source of truth.
- Added a real Settings surface for passkey-account information, authenticated address copy, network/testnet disclosure, funding access, agent-permission access and session close/sign-out. Every button routes to an existing function or authenticated view.
- Added a reusable UX layer for mobile safe-area padding, six-item thumb navigation, readable cards, responsive layouts, 44px-class touch targets and desktop-only rail behavior.
- Updated browser contracts that referred to the removed “Launch Reach” label to the new “Get started with a passkey” contract.
- Corrected the local API drift check/build boundary so esbuild uses the project root and the tracked API artifact can be verified in the restricted Windows environment. No backend payment semantics were changed for this UX pass.

### Feature-completion matrix

| UX surface / workflow | Real implementation retained | New UX connection | Local proof | Live / release gate |
|---|---|---|---|---|
| Landing → passkey account | Existing `AccountGateway` and `connectWallet` flow | `LandingHero` has only real Get started actions; no simulated app preview | `task-005c-ux.spec.ts` CTA and no-preview assertions | Human passkey ceremony on approved staging origin |
| Overview → balance → Send | Existing authoritative balance read and sender flow | `HomeDashboard` is the Overview surface with clear balance, Funding and Send actions | Focused UX browser pass; existing balance tests | Fresh funded account / live reread |
| Send → Activity | Existing payout, wallet transfer, claim-link and activity implementations | Send includes explicit Batch payments link; Activity remains primary history surface | Existing UI and sender/activity suites plus focused navigation pass | Human payout / claim UAT remains separate |
| Agents → paid service result | Existing owner authorization, MPP payer and service output | Agents is a primary navigation destination and retains payment, record, refresh, close and revoke controls | `agent-mpp-journey.spec.ts` passes with paid result, refresh and revoke screenshots | Live Tempo MPP service, receipt and recovery UAT |
| Funding | Existing testnet funding route and balance reread | Funding is a primary navigation destination and Settings deep link | Existing funding/browser tests; UX shell navigation pass | Approved testnet funding UAT |
| Settings → permissions/session close | Existing sign-out and agent revoke/session controls | Added account, network, permission and end-session cards | Focused UX browser navigation; typecheck | Human reconnect, revocation and interrupted-session UAT |
| Mobile and desktop | Existing functional components unchanged at payment boundaries | Mobile bottom nav uses six requested areas; desktop uses a left rail; safe-area/overflow rules added | 390px and 1440px focused screenshots; no-overflow assertions | Device matrix review on approved staging deployment |

### Claim → Mechanism → Boundary → Proof ledger

| Claim | Mechanism | Boundary | Proof |
|---|---|---|---|
| The landing page does not pretend to be a live app | Static content and real navigation callbacks only | Removed `interactive-hero-stage`, animated fake payout and fake claim preview | `task-005c-ux.spec.ts` asserts no preview markers; mobile and desktop landing screenshots |
| A normal user can find every core area | `AppShell` six-item desktop/mobile navigation | Batch is secondary under Send; claim links remain on their existing `/c/:id` route | Focused browser test visits Overview, Settings, Agents, Send and Activity; screenshots show navigation |
| The primary payment actions remain real | Existing `SenderDashboard` callbacks and real balance/payment components | No placeholder button added; CTA callbacks navigate to existing flows | Existing sender/activity/funding suites plus focused Send navigation test |
| Agent payment returns a service result, not only a receipt | Existing MPP payer response body rendered by `AutomationExperience` | Output shown only after receipt verification / successful response | `task-005c-agent-paid-result.png`; focused agent browser test passes |
| Financial state survives refresh | Authenticated owner discovery and per-policy indexes | Owner equality and no secret serialization remain enforced server-side | `task-005c-agent-paid-result.png`, `task-005c-agent-revoked.png`, reload assertions and unit tests |
| Desktop does not show mobile navigation | Responsive cascade hides bottom nav at 900px and above | Six-item bottom nav is mobile-only; desktop rail remains canonical | Final agent screenshot visually reviewed after CSS correction |

### Evidence classification

Deterministic/local evidence:

- The landing and shell browser tests use local Playwright route fixtures for balances, activity, funding reads and owner policy discovery. They prove UI composition, navigation, responsive overflow and real callback wiring without signing or sending live money.
- The agent journey remains deterministic browser-fixture evidence for the paid response, authoritative financial record rendering, refresh recovery and revocation.
- MPP direct/session settlement remains covered by the deterministic local MPPx tests; no live transaction was performed here.

Live Tempo Moderato evidence:

- No new live transaction, owner access-key signature, production secret, deployment or Git push was authorized or attempted for Task 005C-UX.
- The live gates remain: approved staging endpoint and recipient, fresh human passkey account, funding, owner approval, live receipt/reference reread, actual service response, refresh/reconnect, UNKNOWN/interrupted-session exercise, two unrelated live users and passkey revocation.

### Task 005C-UX verification

```text
pnpm typecheck                                      -> PASS
pnpm test:unit                                      -> PASS; 163 passing
pnpm test                                            -> PASS; 40 passing
pnpm check:api-drift                                 -> PASS; tracked api/index.js matches source
pnpm build:web                                       -> PASS; Vite client bundle; large-chunk warning only
git diff --check                                     -> PASS
focused UX + agent browser suite                     -> PASS; 3 passing
  - landing mobile 390x844 and desktop 1440x900
  - authenticated mobile shell navigation / overflow
  - agent paid result / financial record / refresh / revocation
full browser regression                              -> PASS; 76 passing, 0 failing
```

Evidence files delivered:

- [landing mobile](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-ux-landing-mobile-390.png)
- [landing desktop](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-ux-landing-desktop-1440.png)
- [authenticated overview mobile](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-ux-overview-mobile-390.png)
- [authenticated Send mobile](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-ux-send-mobile-390.png)
- [agent paid service result](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-agent-paid-result.png)
- [agent authorization revoked](/C:/Users/HomePC/Desktop/Reach/artifacts/screenshots-v3/task-005c-agent-revoked.png)
- `test/browser/task-005c-ux.spec.ts`

### Review recommendation and next acceptance gate

Recommendation: **UX implementation ready for director review; release remains HOLD.** The local normal journey is coherent and the existing payment/MPP implementation remains connected. Do not promote until the live gates above are completed with explicit approval, including two unrelated-user isolation and interrupted/UNKNOWN payment recovery.

Next acceptance gate: run approved staging UAT from fresh passkey onboarding through Overview → Funding → Agents → paid service result → Activity/financial record → refresh/reconnect → revoke, capture authoritative Tempo Moderato receipts and the two-user isolation evidence, then rerun the full browser and critical backend boundary audit against that deployment.

### Task 005C-UX final Git status

```text
 M .env.example
 M README.md
 M api/index.js
 M director.md
 M package.json
 M pnpm-lock.yaml
 M scripts/agent-payout.ts
 M scripts/check-api-drift.mjs
 M src/client/AppShell.tsx
 M src/client/AutomationExperience.tsx
 M src/client/LandingHero.tsx
 M src/client/SendExperience.tsx
 M src/client/SenderDashboard.tsx
 M src/client/components/Icons.tsx
 M src/client/styles.css
 M src/server/app.ts
 M src/server/kvAdapter.ts
 M test/browser/account-onboarding.spec.ts
 M test/browser/app-session.spec.ts
 M test/browser/auth-login.spec.ts
 M test/browser/identity-continuity.spec.ts
?? docs/task-005-agent-infra-ledger.md
?? src/client/SettingsExperience.tsx
?? src/server/agentAuthorization.ts
?? src/server/mpp.ts
?? src/server/mppPayer.ts
?? test/agentAuthorization.test.ts
?? test/browser/agent-mpp-journey.spec.ts
?? test/browser/task-005c-ux.spec.ts
?? test/mpp.test.ts
?? test/mppLocal.test.ts
```
```

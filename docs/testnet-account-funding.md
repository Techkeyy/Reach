# Testnet account funding: implementation and evidence

Recorded 2026-09-27. Overall BUILDING. Funding local validation is complete; committed deployment verification and owner UAT remain separate gates. No funding UAT PASS is claimed.

## Cold-start reconstruction

- Starting HEAD, local origin/main, and live remote main: `1f9cdad13a16ff27899215b6a9a6082a421fc363`.
- Pre-existing unstaged edits empty five tracked files: `scripts/check-proof-gate.ts`, `scripts/run-proof-gates.ts`, `scripts/test-auth-origin.ts`, `scripts/verify-deployment.ts`, `test/claimRecovery.test.ts`. Total 376 deleted lines. These edits are preserved, not endorsed or restored.
- Pre-existing untracked `scripts/faucet-probe.ts` makes two faucet calls, including a repeated call. It was inspected but NOT executed or modified.
- No faucet result file was located in inspected scripts/docs/deployments/test-results paths. No Reach app/relay listeners were present at reconstruction. A filename-based process check found no independent running faucet probe.
- `.env.local`, `.uat/`, and `.vercel/` are ignored. Their credential values were not displayed. `.uat/` contained only the non-secret handoff sentinel. The CLI's existing Vercel authentication is outside Git; it was used for deployment inspection, not copied into the repo.
- Live stable production health returned HTTP 200: ok=true, chainId=42431, sponsorConfigured=true, webAuthnStorage=durable.
- Vercel CLI resolved production to `dpl_3hS9pqn7VRC2YDx4UFvhdNijgJAn`, `reach-622bqjsso-techkeyys-projects.vercel.app`, created 2026-09-26, status Ready. Exact correspondence to starting HEAD was not proven by that output. A direct metadata API request returned 403; authenticated CLI inspection succeeded.
- Historical README/director sections lag the current implementation. In particular, Phase 4 script output is not by itself a real native batch atomicity proof. Current tests and product claims must be classified by their actual evidence.

## Exactly one live faucet probe

Fresh public throwaway address: `0x96fa82b5d66210d8ad3bc483c16227c3412d5976`. Generated random address bytes only: no private key, passkey, capability, sponsor key, or deployment key was needed.

Chain read: 42431. Before block: 37185083. HTTP 200 from the fixed Moderato RPC. Exact JSON-RPC response:

```json
{"jsonrpc":"2.0","id":42,"result":["0xab4245740a5aa0b337cc68d479f31d521481ad61b0435a972086e9544902d72b","0xbb55ad468430f08d1dc012bbf586b41eeb82fcc3bc277004145f87a79b32f0bc","0xf98fe0039cc144f2a2f1a6b492e268a23fbf42db4bdb36977aba2bacb76ed9a6","0x3e77f12d3f22d6a7c00c4301841eb401f544097e43aa72c8e73a4ed2fea02c56"]}
```

Result is an array of four transaction hashes. All four receipts succeeded in block 37185086. Their logs include test token contracts ending `0000`, `0001`, `0002`, and `0003`, respectively. No second faucet invocation was made.

At block 37185088, all four token balanceOf calls returned `1000000000000`, up from `0` at the before block. Thus exact pathUSD delta is `1000000000000` base units, or `1000000` pathUSD at six decimals. Other assets observed are the three test-token contracts `0x20c0000000000000000000000000000000000001`, `0x20c0000000000000000000000000000000000002`, `0x20c0000000000000000000000000000000000003`; token names/decimals were not independently reread in this probe.

The official [Tempo README](https://github.com/tempoxyz/tempo) documents `tempo_fundAddress` on Moderato. The faucet documentation URL redirected and was unavailable through the research tool. No fixed amount or cooldown guarantee was established from accessible official documentation, and the RPC result contains hashes, not an amount. The UI therefore never promises a fixed faucet amount.

## User journey and mechanism

Sender connects their Reach passkey account, opens Add test funds from Home, sees their public account and authoritative balance, requests once, waits for receipt/balance evidence, and then sees the previous/current balances and Send money.

Technical path: browser POST `/api/testnet/fund` with only `{address}`; server acquires atomic KV reservation, checks chain 42431, reads pathUSD balance, calls `tempo_fundAddress` once without retries, stores only public attempt metadata and returns WAITING_FOR_BALANCE. Browser then polls GET `/api/testnet/fund/:address`; the server rereads receipts and balance. No signing key participates. GET never calls the faucet.

Only fixed RPC `https://rpc.moderato.tempo.xyz`, chain 42431 and pathUSD `0x20c0000000000000000000000000000000000000` are used. The funding service does not use the general REACH_RPC_URL override. Arbitrary request fields, network/token/RPC selectors and zero/invalid addresses are rejected.

## Trust and enforcement ledger

| Claim | Mechanism | Authoritative boundary | Proof and classification |
| --- | --- | --- | --- |
| Funding request is testnet-only | Fixed server RPC/token; live chain ID check | Server request path | Enforced server-side for this endpoint, covered by injected-RPC tests |
| UI success means balance increased | Successful matching receipts plus exact BigInt balanceOf increase; client verifies result identity/network/token and delta | Moderato RPC receipts and pathUSD state | Live primitive proven; application integration automated with mocks, not human UAT |
| Repeated requests are limited | KV create/NX with 600-second TTL before upstream invocation; reservation survives uncertain failure | Existing durable KV in production, process memory locally | Application-enforced per address; no global/IP/Sybil guarantee |
| Address belongs to connected account | Browser supplies connected account; server validates EVM shape | Client selection, not proof of ownership | SOFT ENFORCED in normal UI; ownership UNENFORCED server-side |
| Sender principal remains non-custodial | Faucet delivers directly to address; Reach does not sign or take custody | Faucet and token contract | No hot-wallet principal path introduced |

The WebAuthn handler's session is not currently converted into an authenticated server-side Tempo account identity. Do not describe the endpoint as authenticated ownership binding. A caller can request test funds for another valid public address. Origin checks constrain browser requests, not non-browser callers. Attackers can rotate addresses; global abuse controls remain a limitation.

## Bounded failure and restart behavior

Stages: IDLE, REQUESTING_TEST_FUNDS, WAITING_FOR_BALANCE, FUNDED, FAILED. Individual RPC calls have 8-second limits; funding KV operations have 5-second limits. Confirmation is bounded to 45 seconds on the server and 20 polls/55 seconds in the browser. No automatic faucet retries occur. An ambiguous failure says funds may arrive later and offers a read-only balance check. A reservation remains for at least 10 minutes even on uncertain submission.

Only public address, timestamp, balances, hashes, stage and safe error text are stored under `reach:testnet-fund:42431:<lowercase-address>`. No bearer, passkey credential, or private key is added. The connected component aborts its polling on unmount. Reopening the page rereads current balance; it does not automatically repeat funding. Live production KV durability was reported by health; the new endpoint's actual durable behavior still requires deployment/owner UAT.

## Validation and release gate

| Check | Observed result |
| --- | --- |
| `pnpm typecheck` | PASS, before changes and final rerun |
| `pnpm test` | 40 passing, local Hardhat tests only |
| `pnpm test:unit` | 42 passing entries, including 23 new funding tests and one empty-file entry for the pre-existing emptied claimRecovery test; not 42 meaningful assertion cases |
| `pnpm test:browser` | 41 passing, including 6 new funding tests |
| Additional sender regression command | PASS, 26/26 passing after two approved stale exact-text assertion corrections |
| `pnpm build:web` | PASS; web build and api/index.js rebuilt; existing >500 kB chunk warning |
| `git diff --check` | PASS |
| Visual inspection | Funding component screenshots inspected at 375px and 1280px, wrapping readable, no horizontal overflow |
| Secret-value scan | Four known local secret values compared in memory against 107 tracked/nonignored files; zero matches; values never printed |
| Project-wide UI text audit | 18 pre-existing long-dash findings in test names, not new product UI copy; 0 small-text warnings |

The sender regression had two stale exact-text assertions: `Claim link ready` versus the unchanged component's `Private Claim Link`, and `Copy claim link` / `Reveal link` versus the unchanged component's visible `Copy link` / `Reveal` labels. Under the approved narrow authorization, only those two assertions in `test/senderClaimLink.test.ts` were corrected; `SenderClaimLink.tsx` and all masking, bearer-confidentiality, reveal/copy, warning, and capability behavior remain unchanged. The exact sender regression now passes 26/26.

Some legacy screenshot-only browser tests passed while the local relay was absent and the claim API returned 502. Those passes prove layout checks, not working live claim/API integration. New funding component tests explicitly mock HTTP and pass no real credentials. Full human passkey/funding UAT remains owner-controlled.

This evidence record was captured before the release commit. Production deployment must be verified against the committed SHA and the funding route must be checked beyond a generic SPA HTTP 200; no funding UAT PASS is claimed by this document.

The requested audit/build/design skills changed the work concretely: evidence-first faucet characterization, explicit primitive-versus-product proof, preservation of pre-existing work, bounded failure states, exact balance units, existing design-token reuse, and rendered mobile/desktop inspection. README guidance was limited to verified local behavior; competition/idea-selection research was not restarted for this locked feature.

No real payout, claim, reclaim, batch, agent payout or onward send was performed. The single faucet characterization above is the only authorized chain-changing action in this turn.

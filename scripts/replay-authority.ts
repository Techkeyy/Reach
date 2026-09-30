import { createPublicClient, http, encodeFunctionData, decodeFunctionResult } from "viem";
import { tempoModerato } from "viem/chains";
import { DEFAULT_VAULT_ADDRESS, vaultAbi, payoutFromContractResult, serializePayout } from "../src/shared/reach";
import { resolvePayoutLifecycle } from "../src/client/payoutLifecycle";

// Explicit, read-only historical replay. No wallet, signing, or submission API.
const blockNumber = 37566216n;
const cases = [
  ["90151727528187833753684045857026439861949979472721168811828983171085526033230", "FUNDED"],
  ["115543697009702443829310569687238708172992164666670857559776125647687181587510", "EXPIRED_FUNDED"],
  ["113534573245704110907651654435970065347715436922429705419659504619606705960652", "EXPIRED_FUNDED"],
  ["5827182645165307820791179257379778280885723597263831681079614285211331579015", "RECLAIMED"],
  ["32623884757742957646259674214505491779688334013179864495367932908249507365629", "EXPIRED_FUNDED"],
  ["93498073433633701930643344717792503450852015904643172103856357342860799929715", "EXPIRED_FUNDED"],
  ["24599730976579210805774763736135222048697658670242430770008130491816224571791", "FUNDED"],
] as const;
const client = createPublicClient({ chain: tempoModerato, transport: http("https://rpc.moderato.tempo.xyz", { timeout: 20_000, retryCount: 0 }) });
const block = await client.getBlock({ blockNumber });
const payouts = await Promise.all(cases.map(async ([id, expected]) => {
  const { data } = await client.call({ to: DEFAULT_VAULT_ADDRESS, data: encodeFunctionData({ abi: vaultAbi, functionName: "getPayout", args: [BigInt(id)] }), blockNumber });
  if (!data) throw Error("historical response unavailable");
  const tuple = decodeFunctionResult({ abi: vaultAbi, functionName: "getPayout", data });
  if (!Array.isArray(tuple)) throw Error("expected actual tuple output");
  const payout = serializePayout(payoutFromContractResult(tuple, id));
  const lifecycle = resolvePayoutLifecycle({ authoritativePayout: payout, chainTimestamp: block.timestamp });
  if (lifecycle.financialState !== expected) throw Error(`historical mismatch for ${id}`);
  return { id, expected, data };
}));
console.log(JSON.stringify({ blockNumber: blockNumber.toString(), timestamp: block.timestamp.toString(), payouts }));

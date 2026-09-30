import { payoutFromContractResult, serializePayout } from "../shared/reach";
import { resolvePayoutLifecycle } from "./payoutLifecycle";
import { submitAndReconcile, type SubmitAndReconcileOptions } from "./submitAndReconcile";

type Payout = ReturnType<typeof serializePayout>;
type Options = Omit<SubmitAndReconcileOptions<Payout>, "successPredicate" | "failedPredicate" | "readAuthoritativeState"> & {
  readAuthoritativeState: () => Promise<unknown>;
};

/** Provider/relay response loss cannot overrule a complete current vault read. */
export function submitClaimAndReconcile(options: Options) {
  return submitAndReconcile<Payout>({
    ...options,
    readAuthoritativeState: async () => serializePayout(payoutFromContractResult(await options.readAuthoritativeState(), options.operation.payoutIds[0])),
    successPredicate: value => resolvePayoutLifecycle({ authoritativePayout: value }).financialState === "CLAIMED",
    failedPredicate: value => resolvePayoutLifecycle({ authoritativePayout: value }).financialState === "RECLAIMED",
  });
}

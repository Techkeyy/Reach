import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createChainClock, type ChainTimeReader } from "./chainTime";

export function useChainClock(reader: ChainTimeReader | undefined, enabled: boolean) {
  const clock = useMemo(() => createChainClock(reader ?? {
    getBlock: async () => { throw new Error("chain reader unavailable"); },
  }), [reader]);
  const timestamp = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    void clock.refresh({ force: true });
    const interval = window.setInterval(() => { void clock.refreshIfFresh(); }, 15_000);
    const onFocus = () => { void clock.refreshIfFresh(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [clock, enabled]);
  return { timestamp, refresh: clock.refresh };
}

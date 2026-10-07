import { QueryClient } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { tempoModerato } from "wagmi/chains";
import { webAuthn } from "wagmi/tempo";
import { createRecoveryAwareCeremony } from "./identityRecovery";

export const queryClient = new QueryClient();

export const wagmiConfig = createConfig({
  chains: [tempoModerato],
  connectors: [
    webAuthn({
      testnet: true,
      ceremony: createRecoveryAwareCeremony("/auth"),
      feePayer: "/relay",
    }),
  ],
  multiInjectedProviderDiscovery: false,
  transports: {
    // Read retries are coordinated by the server/API paths and explicit
    // preflight callers. Disable viem's implicit retry fanout in the browser.
    [tempoModerato.id]: http(import.meta.env.VITE_TEMPO_RPC_URL ?? "https://rpc.moderato.tempo.xyz", { retryCount: 0, retryDelay: 0, timeout: 10_000 }),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

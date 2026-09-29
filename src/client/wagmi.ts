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
    [tempoModerato.id]: http(import.meta.env.VITE_TEMPO_RPC_URL ?? "https://rpc.moderato.tempo.xyz"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

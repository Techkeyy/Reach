import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: { version: "0.8.34" },
      production: { version: "0.8.34", settings: { optimizer: { enabled: true, runs: 200 } } },
    },
  },
  networks: {
    hardhatMainnet: { type: "edr-simulated", chainType: "l1" },
    tempoModerato: {
      type: "http",
      chainType: "l1",
      url: process.env.TEMPO_MODERATO_RPC_URL ?? "https://rpc.moderato.tempo.xyz",
      accounts: process.env.TEMPO_DEPLOYER_PRIVATE_KEY ? [configVariable("TEMPO_DEPLOYER_PRIVATE_KEY")] : [],
    },
  },
});

import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import App from "./App";
import { installDevelopmentDiagnostics } from "./diagnostics";
import { queryClient, wagmiConfig } from "./wagmi";
import "@fontsource-variable/geist";
import "@fontsource/instrument-serif/400-italic.css";
import "./styles.css";
import "./sender.css";

installDevelopmentDiagnostics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);

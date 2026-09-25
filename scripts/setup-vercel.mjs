import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const authFile = "C:\\Users\\HomePC\\AppData\\Roaming\\com.vercel.cli\\Data\\auth.json";
if (!fs.existsSync(authFile)) {
  console.error("Vercel auth.json not found!");
  process.exit(1);
}

const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
const token = auth.token;

const envLocal = dotenv.parse(fs.readFileSync(".env.local", "utf8"));
const feePayerKey = envLocal.REACH_FEE_PAYER_PRIVATE_KEY;
if (!feePayerKey) {
  console.error("REACH_FEE_PAYER_PRIVATE_KEY missing from .env.local!");
  process.exit(1);
}

async function api(endpoint, method = "GET", body = null) {
  const res = await fetch(`https://api.vercel.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Vercel API error ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  console.log("Checking Vercel project...");
  let project;
  try {
    project = await api("/v9/projects/reach");
    console.log("Found existing project 'reach':", project.id);
  } catch (err) {
    console.log("Creating project 'reach'...");
    try {
      project = await api("/v9/projects", "POST", {
        name: "reach",
        framework: "vite",
        gitRepository: {
          type: "github",
          repo: "Techkeyy/Reach",
        },
      });
      console.log("Created project:", project.name, project.id);
    } catch (createErr) {
      console.log("Project name 'reach' may be taken, trying 'reach-pay'...");
      project = await api("/v9/projects", "POST", {
        name: "reach-pay",
        framework: "vite",
        gitRepository: {
          type: "github",
          repo: "Techkeyy/Reach",
        },
      });
      console.log("Created project:", project.name, project.id);
    }
  }

  // Verified stable domain
  const prodHost = "reach-seven-lemon.vercel.app";
  const prodOrigin = `https://${prodHost}`;
  console.log("Target stable production host:", prodHost);
  console.log("Target stable production origin:", prodOrigin);

  const envsToSet = [
    { key: "REACH_FEE_PAYER_PRIVATE_KEY", value: feePayerKey, type: "encrypted", target: ["production", "preview", "development"] },
    { key: "REACH_VAULT_ADDRESS", value: "0x98262c02746f3b91342249159deeebe87a54266c", type: "plain", target: ["production", "preview", "development"] },
    { key: "REACH_RPC_URL", value: "https://rpc.moderato.tempo.xyz", type: "plain", target: ["production", "preview", "development"] },
    { key: "REACH_INDEXER_URL", value: "https://indexer.testnet.tempo.xyz/query", type: "plain", target: ["production", "preview", "development"] },
    { key: "REACH_ORIGIN", value: prodOrigin, type: "plain", target: ["production", "preview"] },
    { key: "REACH_RP_ID", value: prodHost, type: "plain", target: ["production", "preview"] },
    { key: "VITE_TEMPO_RPC_URL", value: "https://rpc.moderato.tempo.xyz", type: "plain", target: ["production", "preview", "development"] },
    { key: "VITE_REACH_VAULT_ADDRESS", value: "0x98262c02746f3b91342249159deeebe87a54266c", type: "plain", target: ["production", "preview", "development"] },
  ];

  console.log("Configuring server-side environment variables on Vercel...");
  const existingEnvs = await api(`/v9/projects/${project.id}/env`);
  const existingMap = new Map((existingEnvs.envs || []).map((e) => [e.key, e.id]));

  for (const env of envsToSet) {
    if (existingMap.has(env.key)) {
      console.log(`Updating env var ${env.key}...`);
      await api(`/v9/projects/${project.id}/env/${existingMap.get(env.key)}`, "PATCH", {
        value: env.value,
        target: env.target,
        type: env.type,
      });
    } else {
      console.log(`Creating env var ${env.key}...`);
      await api(`/v10/projects/${project.id}/env`, "POST", env);
    }
  }

  console.log("Triggering deployment...");
  // Trigger deployment via API
  const deployment = await api("/v13/deployments", "POST", {
    name: project.name,
    project: project.id,
    gitSource: {
      type: "github",
      repo: "Techkeyy/Reach",
      repoId: 1386924453,
      ref: "main",
    },
  });

  console.log("Deployment initiated:", deployment.id, deployment.url);
  console.log("Project name:", project.name);
  console.log("Production URL:", `https://${prodHost}`);
}

main().catch((err) => {
  console.error("Error in setup-vercel:", err);
  process.exit(1);
});

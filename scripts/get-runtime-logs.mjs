import fs from "node:fs";

const auth = JSON.parse(fs.readFileSync("C:/Users/HomePC/AppData/Roaming/com.vercel.cli/Data/auth.json", "utf8"));
const deploymentId = process.argv[2] || "dpl_EJoyGQi3XjRykzRjKPosx1zZ2eJ8";

async function main() {
  const res = await fetch(`https://api.vercel.com/v2/deployments/${deploymentId}/events?limit=100&direction=backward`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  const events = await res.json();
  console.log(`Found ${events.length} events:`);
  for (const e of events) {
    console.log(`[${e.type || e.payload?.info?.type || "unknown"}]`, e.text || e.payload?.text || JSON.stringify(e));
  }
}

main().catch(console.error);

import fs from "node:fs";

const authFile = "C:\\Users\\HomePC\\AppData\\Roaming\\com.vercel.cli\\Data\\auth.json";
const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
const token = auth.token;
const deploymentId = process.argv[2] || "dpl_EWdRLK4WZC5G23nhBwL5PD9TfhYW";

async function getLogs() {
  const res = await fetch(`https://api.vercel.com/v2/deployments/${deploymentId}/events`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (Array.isArray(data)) {
    for (const event of data) {
      console.log(`[${event.type || "log"}] ${event.text || event.payload?.text || JSON.stringify(event)}`);
    }
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

getLogs().catch(console.error);

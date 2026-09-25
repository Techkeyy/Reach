import fs from "node:fs";

const authFile = "C:\\Users\\HomePC\\AppData\\Roaming\\com.vercel.cli\\Data\\auth.json";
const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
const token = auth.token;
const deploymentId = process.argv[2] || "dpl_EWdRLK4WZC5G23nhBwL5PD9TfhYW";

async function check() {
  const res = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  console.log(`Deployment ${deploymentId} status: ${data.status} (readyState: ${data.readyState})`);
  if (data.status === "ERROR" || data.readyState === "ERROR") {
    console.error("Deployment Error Details:", JSON.stringify(data.error || data, null, 2));
  }
  return data;
}

check().catch(console.error);

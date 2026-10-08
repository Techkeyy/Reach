import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiEntry = path.join(root, "api", "index.js");
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "reach-api-drift-"));
const generatedEntry = path.join(temporaryDirectory, "index.js");

try {
  await build({
    entryPoints: [path.join(root, "src", "server", "serverlessHandler.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: generatedEntry,
    packages: "external",
    logLevel: "silent",
  });

  const [tracked, generated] = await Promise.all([
    readFile(apiEntry, "utf8"),
    readFile(generatedEntry, "utf8"),
  ]);

  if (tracked !== generated) {
    console.error("Tracked api/index.js is stale. Run pnpm build:api and review the generated diff.");
    process.exitCode = 1;
  } else {
    console.log("Tracked api/index.js matches src/server/serverlessHandler.ts.");
  }
} catch (error) {
  console.error(`API artifact drift check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

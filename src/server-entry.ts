import { config as loadEnv } from "dotenv";

loadEnv({ path: process.env.REACH_ENV_FILE ?? ".env.local" });
import { serve } from "@hono/node-server";
import { createApp } from "./server/app.js";

const app = createApp({ serveStaticFallback: true });
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) });

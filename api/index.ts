import { handle } from "hono/vercel";
import { createApp } from "../src/server/app";

export const config = {
  runtime: "edge",
};

const app = createApp({ serveStaticFallback: false });

export default handle(app);

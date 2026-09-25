import { getRequestListener } from "@hono/node-server";
import { createApp } from "../src/server/app";

const app = createApp({ serveStaticFallback: false });

export default getRequestListener(app.fetch);

import { handle } from "hono/vercel";
import { createApp } from "../src/server/app";

const app = createApp({ serveStaticFallback: false });

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
export default handle(app);

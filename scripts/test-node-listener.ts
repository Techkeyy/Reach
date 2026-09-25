import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createApp } from "../src/server/app";

const app = createApp({ serveStaticFallback: false });

export async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  try {
    const host = req.headers["x-forwarded-host"] || req.headers.host || "reach-seven-lemon.vercel.app";
    const proto = req.headers["x-forwarded-proto"] || "https";
    const url = new URL(req.url || "/", `${proto}://${host}`);

    let body: BodyInit | undefined = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (req.body !== undefined) {
        body = typeof req.body === "string" || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
      } else {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        if (chunks.length > 0) {
          body = Buffer.concat(chunks);
        }
      }
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.set(key, value);
      }
    }

    const webReq = new Request(url.toString(), {
      method: req.method,
      headers,
      body,
      // @ts-ignore
      duplex: "half",
    });

    const webRes = await app.fetch(webReq);

    res.statusCode = webRes.status;
    webRes.headers.forEach((val, key) => {
      res.setHeader(key, val);
    });

    const arrayBuffer = await webRes.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err: any) {
    console.error("Vercel Function error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: err?.message || "Internal server error" }));
    }
  }
}

async function run() {
  const server = http.createServer(handler);
  server.listen(0, async () => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return;
    const port = addr.port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      console.log("/health status:", res.status, "body:", await res.json());

      const res2 = await fetch(`http://127.0.0.1:${port}/auth/register/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Reach sender" }),
      });
      console.log("/auth status:", res2.status, "body:", await res2.json());
    } catch (e) {
      console.error(e);
    } finally {
      server.close();
      process.exit(0);
    }
  });
}

run();

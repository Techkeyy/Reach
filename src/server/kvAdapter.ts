import { Kv } from "accounts/server";

export function createKvStore(): Kv.Kv {
  const restUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !restToken) {
    return Kv.memory();
  }

  const cleanUrl = restUrl.replace(/\/$/, "");

  async function executeCommand<T = unknown>(command: (string | number)[]): Promise<T> {
    const response = await fetch(cleanUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${restToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (!response.ok) {
      throw new Error(`KV REST command failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { result: T; error?: string };
    if (data.error) {
      throw new Error(`KV REST error: ${data.error}`);
    }
    return data.result;
  }

  const kvStore: Kv.Kv = {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      try {
        const raw = await executeCommand<string | null>(["GET", key]);
        if (raw === null || raw === undefined) return undefined;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return raw as unknown as T;
        }
      } catch {
        return undefined;
      }
    },
    async set(key: string, value: unknown, options?: { ttl?: number }): Promise<void> {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      if (options?.ttl) {
        await executeCommand(["SET", key, serialized, "EX", options.ttl]);
      } else {
        await executeCommand(["SET", key, serialized]);
      }
    },
    async delete(key: string): Promise<void> {
      await executeCommand(["DEL", key]);
    },
    async create(key: string, value: unknown, options?: { ttl?: number }): Promise<boolean> {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      const args: (string | number)[] = ["SET", key, serialized, "NX"];
      if (options?.ttl) {
        args.push("EX", options.ttl);
      }
      const res = await executeCommand<string | null>(args);
      return res === "OK";
    },
    async take<T = unknown>(key: string): Promise<T | undefined> {
      const val = await kvStore.get<T>(key);
      if (val !== undefined) {
        await kvStore.delete(key);
      }
      return val;
    },
  };

  return Kv.from(kvStore);
}

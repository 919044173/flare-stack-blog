import type { z } from "zod";
import type { Duration } from "@/lib/duration";
import { ms } from "@/lib/duration";
import { serializeKey } from "./serialize";
import type { CacheKey } from "./types";

// 防止缓存击穿：同一 key 的并发请求复用同一个 Promise
const inFlightRemember = new Map<string, Promise<unknown>>();

export async function get(
  context: BaseContext,
  key: CacheKey,
): Promise<string | null> {
  const serializedKey = serializeKey(key);
  const value = await context.env.KV.get(serializedKey).catch((err) => {
    console.error(
      JSON.stringify({
        message: "kv store get failed",
        key: serializedKey,
        error: String(err),
      }),
    );
    return null;
  });
  return value;
}

export async function put(
  context: BaseContext,
  key: CacheKey,
  value: string,
  options?: { ttl?: Duration },
): Promise<void> {
  const serializedKey = serializeKey(key);
  const putOptions = options?.ttl
    ? { expirationTtl: Math.floor(ms(options.ttl) / 1000) }
    : undefined;

  await context.env.KV.put(serializedKey, value, putOptions).catch((err) =>
    console.error(
      JSON.stringify({
        message: "kv store put failed",
        key: serializedKey,
        error: String(err),
      }),
    ),
  );
}

export async function remove(
  context: BaseContext,
  ...keys: Array<CacheKey>
): Promise<void> {
  const serializedKeys = keys.map(serializeKey);

  await Promise.all(
    serializedKeys.map((key) =>
      context.env.KV.delete(key).catch((err) =>
        console.error(
          JSON.stringify({
            message: "kv store delete failed",
            key,
            error: String(err),
          }),
        ),
      ),
    ),
  );
}

export async function remember<T extends z.ZodTypeAny>(
  context: BaseContext & { executionCtx: ExecutionContext },
  key: CacheKey,
  schema: T,
  fetcher: () => Promise<z.infer<T>>,
  options: { ttl?: Duration } = {},
): Promise<z.infer<T>> {
  const { ttl = "1h" } = options;
  const serializedKey = serializeKey(key);

  // 1. 并发合并：同一 key 已有在途请求 → 直接复用
  const pending = inFlightRemember.get(serializedKey);
  if (pending) {
    return pending as Promise<z.infer<T>>;
  }

  // 2. 构建整个读取 + 回写逻辑为一个 Promise
  const promise = (async () => {
    const stored = await context.env.KV.get(serializedKey, "json").catch(
      (err) =>
        console.error(
          JSON.stringify({
            message: "kv store remember get failed",
            key: serializedKey,
            error: String(err),
          }),
        ),
    );

    if (stored !== null && stored !== undefined) {
      const result = schema.safeParse(stored);
      if (result.success) return result.data;
    }

    const data = await fetcher();
    if (data === null || data === undefined) return data;

    context.executionCtx.waitUntil(
      put(context, key, JSON.stringify(data), { ttl }),
    );
    return data;
  })();

  // 3. 存入 Map，请求结束后清理
  inFlightRemember.set(serializedKey, promise);
  promise.finally(() => {
    inFlightRemember.delete(serializedKey);
  });

  return promise as Promise<z.infer<T>>;
}
import type { z } from "zod";
import type { Duration } from "@/lib/duration";
import { ms } from "@/lib/duration";
import { serializeKey } from "./serialize";
import type {
  CacheKey,
  PublicCacheReadContext,
  PublicCacheReason,
} from "./types";
import { purgeWorkersCache } from "./workers-cache";
import { purgeOptionsFor } from "./workers-cache-policy";

type InvalidateContext = BaseContext & {
  executionCtx: ExecutionContext;
};

type EntryConfig<
  TParams extends Record<string, unknown>,
  TSchema extends z.ZodTypeAny,
> = {
  name: string;
  key: (params: TParams) => CacheKey;
  schema: TSchema;
  load: (
    context: PublicCacheReadContext,
    params: TParams,
  ) => Promise<z.infer<TSchema>>;
  invalidatedBy: readonly PublicCacheReason[];
  address?: ReadonlyArray<keyof TParams & string>;
  namespace?: string;
  ttl?: Duration;
  hydrate?: (data: z.infer<TSchema>) => z.infer<TSchema>;
};

export type PublicCacheEntry<TParams extends Record<string, unknown>, TData> = {
  name: string;
  get: (context: PublicCacheReadContext, params: TParams) => Promise<TData>;
};

type RegisteredEntry = {
  name: string;
  namespace?: string;
  address: readonly string[];
  ttl: Duration;
  invalidatedBy: readonly PublicCacheReason[];
  key: (params: Record<string, unknown>) => CacheKey;
  schema: z.ZodTypeAny;
  load: (
    context: PublicCacheReadContext,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
  hydrate?: (data: unknown) => unknown;
};

const registry: RegisteredEntry[] = [];

// 防止缓存击穿：记录正在读取/写入的 key，避免并发请求同时写 KV
const inFlightRequests = new Map<string, Promise<unknown>>();

// 防止 bumpGeneration 高频写入 KV：每个 namespace 5 分钟内只 bump 一次
const lastBumpAt = new Map<string, number>();
const BUMP_MIN_INTERVAL_MS = 5 * 60 * 1000;

async function readGeneration(
  context: InvalidateContext,
  namespace: string,
): Promise<string | null> {
  const key = `ver:${namespace}`;
  let generation: string | null;
  try {
    generation = await context.env.KV.get(key);
  } catch (err) {
    console.error(
      JSON.stringify({
        message: "public cache get version failed",
        key,
        error: String(err),
      }),
    );
    return null;
  }

  if (generation === null) return "v0";
  if (generation.length === 0) {
    console.error(
      JSON.stringify({
        message: "public cache generation invalid",
        key,
        error: "cache generation is empty",
      }),
    );
    return null;
  }

  return `v${generation}`;
}

async function bumpGeneration(
  context: InvalidateContext,
  namespace: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const now = Date.now();
  const last = lastBumpAt.get(namespace) ?? 0;

  // 5 分钟内同一 namespace 只 bump 一次（force 可跳过）
  if (!options.force && now - last < BUMP_MIN_INTERVAL_MS) {
    return;
  }
  lastBumpAt.set(namespace, now);

  const key = `ver:${namespace}`;
  const generation = crypto.randomUUID();

  try {
    await context.env.KV.put(key, generation, {
      // 版本号自带 TTL，避免旧 key 长期占用空间
      expirationTtl: 60 * 60 * 24 * 30,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        message: "public cache bump version failed",
        key,
        error: String(err),
      }),
    );
    throw err;
  }
}

function logicalKey(
  entry: RegisteredEntry,
  params: Record<string, unknown>,
): CacheKey {
  return entry.key(params);
}

function storageKey(version: string | undefined, key: CacheKey): string {
  const logical = serializeKey(key);
  return version ? `${version}:${logical}` : logical;
}

function isAddressable(
  entry: RegisteredEntry,
  params: Record<string, unknown>,
): boolean {
  if (entry.namespace && entry.address.length === 0) return false;
  return entry.address.every(
    (name) => params[name] !== undefined && params[name] !== null,
  );
}

async function deleteStorageKey(
  context: InvalidateContext,
  serializedKey: string,
): Promise<void> {
  await context.env.KV.delete(serializedKey).catch((err) =>
    console.error(
      JSON.stringify({
        message: "public cache delete failed",
        key: serializedKey,
        error: String(err),
      }),
    ),
  );
}

async function readEntry<T>(
  entry: RegisteredEntry,
  context: PublicCacheReadContext,
  params: Record<string, unknown>,
): Promise<T> {
  let version: string | undefined;
  if (entry.namespace) {
    const generation = await readGeneration(context, entry.namespace);
    if (generation === null) {
      return (await entry.load(context, params)) as T;
    }
    version = generation;
  }

  const serializedKey = storageKey(version, logicalKey(entry, params));

  // 1. 已有相同请求在途 → 复用其 Promise，避免并发击穿
  const pending = inFlightRequests.get(serializedKey);
  if (pending) {
    return pending as Promise<T>;
  }

  // 2. 构建整个读取 + 回写逻辑为一个 Promise
  const promise = (async () => {
    const stored = await context.env.KV.get(serializedKey, "json").catch(
      (err) =>
        console.error(
          JSON.stringify({
            message: "public cache get failed",
            key: serializedKey,
            error: String(err),
          }),
        ),
    );

    const persist = async (value: unknown) => {
      await context.env.KV.put(serializedKey, JSON.stringify(value), {
        expirationTtl: Math.floor(ms(entry.ttl) / 1000),
      }).catch((err) =>
        console.error(
          JSON.stringify({
            message: "public cache set failed",
            key: serializedKey,
            error: String(err),
          }),
        ),
      );
    };

    // 2.1 缓存命中
    if (stored !== null && stored !== undefined) {
      const parsed = entry.schema.safeParse(stored);
      if (parsed.success) {
        const data = entry.hydrate ? entry.hydrate(parsed.data) : parsed.data;
        if (
          entry.hydrate &&
          JSON.stringify(data) !== JSON.stringify(parsed.data)
        ) {
          context.executionCtx.waitUntil(persist(data));
        }
        return data as T;
      }
    }

    // 2.2 缓存未命中，加载数据
    const loaded = await entry.load(context, params);
    if (loaded === null || loaded === undefined) return loaded as T;

    const data = entry.hydrate ? entry.hydrate(loaded) : loaded;
    context.executionCtx.waitUntil(persist(data));
    return data as T;
  })();

  // 3. 存入 Map，请求结束后清理
  inFlightRequests.set(serializedKey, promise);
  promise.finally(() => {
    inFlightRequests.delete(serializedKey);
  });

  return promise as Promise<T>;
}

async function invalidateEntry(
  entry: RegisteredEntry,
  context: InvalidateContext,
  params: Record<string, unknown>,
  options: { force?: boolean } = {},
): Promise<void> {
  if (entry.namespace && !isAddressable(entry, params)) {
    await bumpGeneration(context, entry.namespace, options);
    return;
  }

  let version: string | undefined;
  if (entry.namespace) {
    const generation = await readGeneration(context, entry.namespace);
    if (generation === null) return;
    version = generation;
  }

  await deleteStorageKey(
    context,
    storageKey(version, logicalKey(entry, params)),
  );
}

async function run(
  reason: PublicCacheReason,
  context: InvalidateContext,
  params: Record<string, unknown>,
  options: { force?: boolean } = {},
): Promise<void> {
  await Promise.all(
    registry
      .filter((entry) => entry.invalidatedBy.includes(reason))
      .map((entry) => invalidateEntry(entry, context, params, options)),
  );
}

export function defineEntry<
  TParams extends Record<string, unknown>,
  TSchema extends z.ZodTypeAny,
>(
  config: EntryConfig<TParams, TSchema>,
): PublicCacheEntry<TParams, z.infer<TSchema>> {
  const registered: RegisteredEntry = {
    name: config.name,
    namespace: config.namespace,
    address: config.address ?? [],
    ttl: config.ttl ?? "7d",
    invalidatedBy: config.invalidatedBy,
    key: (params) => config.key(params as TParams),
    schema: config.schema,
    load: (context, params) => config.load(context, params as TParams),
    hydrate: config.hydrate
      ? (data) => config.hydrate!(data as z.infer<TSchema>)
      : undefined,
  };
  registry.push(registered);

  return {
    name: config.name,
    get: (context, params) =>
      readEntry(registered, context, params as Record<string, unknown>),
  };
}

export const invalidate = {
  // 阅读量等高频事件：走节流，5 分钟最多写 1 次 KV
  async postPopularityUpdated(context: InvalidateContext) {
    await run("post-popularity.updated", context, {});
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("post-popularity.updated", {}),
    );
  },
  // 发布文章：force 立即生效
  async postPublished(context: InvalidateContext, params: { slug: string }) {
    await run("post.published", context, params, { force: true });
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("post.published", params),
    );
  },
  // 删除文章：force 立即生效
  async postDeleted(context: InvalidateContext, params: { slug: string }) {
    await run("post.deleted", context, params, { force: true });
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("post.deleted", params),
    );
  },
  async tagChanged(context: InvalidateContext, params?: { slugs?: string[] }) {
    const slugs = params?.slugs ?? [];
    // 批量处理：只跑一次 run，避免每个 slug 单独触发一次缓存失效
    await run("tag.changed", context, { slugs });
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("tag.changed", slugs.length > 0 ? { slugs } : {}),
    );
  },
  async categoryChanged(
    context: InvalidateContext,
    params?: { slugs?: string[] },
  ) {
    const slugs = params?.slugs ?? [];
    // 批量处理：只跑一次 run
    await run("category.changed", context, { slugs });
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("category.changed", slugs.length > 0 ? { slugs } : {}),
    );
  },
  async friendLinksChanged(context: InvalidateContext) {
    await run("friend-links.changed", context, {});
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("friend-links.changed", {}),
    );
  },
  async siteConfigChanged(context: InvalidateContext) {
    await run("site-config.changed", context, { force: true });
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("site-config.changed", {}),
    );
  },
  async all(context: InvalidateContext) {
    await Promise.all(
      registry.map((entry) =>
        invalidateEntry(entry, context, {}, { force: true }),
      ),
    );
    await purgeWorkersCache(context.executionCtx, purgeOptionsFor("all", {}));
  },
};
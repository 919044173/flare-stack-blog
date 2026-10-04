// src/features/cache/public-cache.ts

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
import { allowWrite, shouldSkipWrite } from "./cache-throttle";

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

// 令牌桶：KV 写操作按 reason 维度限流。
// 同一 reason 每分钟最多 N 次写，连点保存会被合并。
const KV_WRITE_LIMIT = 20;
const KV_WRITE_WINDOW_MS = 60 * 1000;

/**
 * 生成一个随机的 cache generation 字符串。
 * crypto.randomUUID 在部分环境不可用时，退化为时间戳 + 随机串。
 */
function newGeneration(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

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
  options: { force?: boolean; reason?: string } = {},
): Promise<void> {
  const key = `ver:${namespace}`;

  // 1. reason 级令牌桶：连点合并
  if (
    options.reason &&
    !allowWrite(options.reason, {
      limit: KV_WRITE_LIMIT,
      windowMs: KV_WRITE_WINDOW_MS,
    })
  ) {
    return;
  }

  // 2. key 级最小间隔节流
  if (shouldSkipWrite(key, options.force)) {
    return;
  }

  // 3. 写 KV —— 失败也不抛错，避免缓存层故障拖垮业务
  try {
    await context.env.KV.put(key, newGeneration(), {
      // 版本号自带 TTL，避免旧 key 长期占用空间
      expirationTtl: 60 * 60,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        message: "public cache bump version failed",
        key,
        error: String(err),
      }),
    );
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
  options: { force?: boolean; reason?: string } = {},
): Promise<void> {
  // 1. reason 级令牌桶：连点合并
  if (
    options.reason &&
    !allowWrite(options.reason, {
      limit: KV_WRITE_LIMIT,
      windowMs: KV_WRITE_WINDOW_MS,
    })
  ) {
    return;
  }

  // 2. key 级最小间隔节流
  if (shouldSkipWrite(serializedKey, options.force)) {
    return;
  }

  // 3. 删除 KV —— 失败也不抛错
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
      // 读路径的缓存回写：失败也不抛错
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
  options: { force?: boolean; reason?: string } = {},
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
    options,
  );
}

/**
 * 批量失效：对订阅了该 reason 的所有 entry 执行失效。
 *
 * 优化点：
 * 1. 先计算所有目标 key，去重后执行，避免同一 key 被重复 delete。
 * 2. reason 级令牌桶 + key 级最小间隔节流，连点保存不会打爆 KV。
 * 3. 所有 KV 写操作都不会抛错，缓存层故障不影响业务。
 */
async function run(
  reason: PublicCacheReason,
  context: InvalidateContext,
  params: Record<string, unknown>,
  options: { force?: boolean } = {},
): Promise<void> {
  const entries = registry.filter((entry) =>
    entry.invalidatedBy.includes(reason),
  );

  // 需要 bump 的 namespace 去重
  const namespacesToBump = new Set<string>();
  // 需要 delete 的 storage key 去重
  const keysToDelete = new Set<string>();

  for (const entry of entries) {
    if (entry.namespace && !isAddressable(entry, params)) {
      namespacesToBump.add(entry.namespace);
      continue;
    }

    let version: string | undefined;
    if (entry.namespace) {
      const generation = await readGeneration(context, entry.namespace);
      if (generation === null) continue;
      version = generation;
    }

    keysToDelete.add(storageKey(version, logicalKey(entry, params)));
  }

  const tasks: Array<Promise<void>> = [];

  for (const namespace of namespacesToBump) {
    tasks.push(
      bumpGeneration(context, namespace, {
        force: options.force,
        reason,
      }),
    );
  }

  for (const key of keysToDelete) {
    tasks.push(
      deleteStorageKey(context, key, {
        force: options.force,
        reason,
      }),
    );
  }

  await Promise.all(tasks);
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

/**
  // 阅读量等高频事件：走令牌桶限流，连点合并
  async postPopularityUpdated(context: InvalidateContext) {
    await run("post-popularity.updated", context, {});
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("post-popularity.updated", {}),
      { throttleKey: "post-popularity.updated" },
    );
  },
*/

  // 发布文章：立即生效（force），但 purge 仍走令牌桶
  async postPublished(context: InvalidateContext, params: { slug: string }) {
    await run("post.published", context, params, { force: true });
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("post.published", params),
      { throttleKey: "post.published" },
    );
  },

  // 删除文章：立即生效（force）
  async postDeleted(context: InvalidateContext, params: { slug: string }) {
    await run("post.deleted", context, params, { force: true });
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("post.deleted", params),
      { throttleKey: "post.deleted" },
    );
  },

  // 标签变更：走限流（不 force），连点合并
  async tagChanged(context: InvalidateContext, params?: { slugs?: string[] }) {
    const slugs = params?.slugs ?? [];
    await run("tag.changed", context, { slugs });
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("tag.changed", slugs.length > 0 ? { slugs } : {}),
      { throttleKey: "tag.changed" },
    );
  },

  // 分类变更：走限流（不 force），连点合并
  async categoryChanged(
    context: InvalidateContext,
    params?: { slugs?: string[] },
  ) {
    const slugs = params?.slugs ?? [];
    await run("category.changed", context, { slugs });
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("category.changed", slugs.length > 0 ? { slugs } : {}),
      { throttleKey: "category.changed" },
    );
  },

  async friendLinksChanged(context: InvalidateContext) {
    await run("friend-links.changed", context, {});
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("friend-links.changed", {}),
      { throttleKey: "friend-links.changed" },
    );
  },

  async siteConfigChanged(context: InvalidateContext) {
    await run("site-config.changed", context, {}, { force: true });
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("site-config.changed", {}),
      { throttleKey: "site-config.changed" },
    );
  },

  async all(context: InvalidateContext) {
    await Promise.all(
      registry.map((entry) =>
        invalidateEntry(entry, context, {}, { force: true, reason: "all" }),
      ),
    );
    await purgeWorkersCache(
      context.executionCtx,
      purgeOptionsFor("all", {}),
      { throttleKey: "all" },
    );
  },
};
import type { WorkersCachePurgeTarget } from "./workers-cache-policy";

const TAGS_PER_PURGE = 100;

// 防止 purgeWorkersCache 高频调用触发 Cloudflare 速率限制
const lastPurgeAt = new Map<string, number>();
const PURGE_MIN_INTERVAL_MS = 30 * 1000; // 同一批 tag 30 秒内只 purge 一次

export type WorkersCachePurgeContext = {
  exports: {
    App: {
      purgeCache: (target: WorkersCachePurgeTarget) => Promise<void>;
    };
  };
};

export function hasWorkersCachePurge(cache: { purge?: unknown }): cache is {
  purge: (options: CachePurgeOptions) => Promise<CachePurgeResult>;
} {
  return typeof cache.purge === "function";
}

async function assertPurge(result: CachePurgeResult) {
  if (result.success) return;
  throw new Error(
    JSON.stringify({
      message: "workers cache purge failed",
      errors: result.errors,
    }),
  );
}

export async function applyWorkersCachePurge(
  cache: { purge?: unknown } | undefined,
  target: WorkersCachePurgeTarget,
) {
  if (!cache || !hasWorkersCachePurge(cache)) return;

  if ("purgeEverything" in target) {
    await assertPurge(await cache.purge(target));
    return;
  }

  const tags = [...new Set(target.tags)];
  if (tags.length === 0) return;

  for (let i = 0; i < tags.length; i += TAGS_PER_PURGE) {
    await assertPurge(
      await cache.purge({ tags: tags.slice(i, i + TAGS_PER_PURGE) }),
    );
  }
}

export async function purgeWorkersCache(
  ctx: WorkersCachePurgeContext,
  target: WorkersCachePurgeTarget,
) {
  // 构造节流 key：tags 排序后拼字符串，purgeEverything 单独处理
  const throttleKey =
    "purgeEverything" in target
      ? "__everything__"
      : target.tags.slice().sort().join(",");

  const now = Date.now();
  const last = lastPurgeAt.get(throttleKey) ?? 0;

  if (now - last < PURGE_MIN_INTERVAL_MS) {
    // 30 秒内同一批 tag 已 purge 过，直接跳过
    return;
  }
  lastPurgeAt.set(throttleKey, now);

  try {
    await ctx.exports.App.purgeCache(target);
  } catch (err) {
    // 速率限制或其它 purge 失败不应阻塞主流程
    console.error(
      JSON.stringify({
        message: "workers cache purge failed",
        target,
        error: String(err),
      }),
    );
  }
}
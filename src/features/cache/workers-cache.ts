import type { WorkersCachePurgeTarget } from "./workers-cache-policy";
import { allowWrite } from "./cache-throttle";

const TAGS_PER_PURGE = 100;

// 防止 purgeWorkersCache 高频调用触发 Cloudflare 速率限制。
// 采用令牌桶：同一 throttleKey 每分钟最多 5 次 purge。
const PURGE_LIMIT = 5;
const PURGE_WINDOW_MS = 60 * 1000;

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

/**
 * 通过 App entrypoint 触发 Workers Cache purge。
 *
 * @param ctx Workers purge context
 * @param target purge 目标
 * @param options.throttleKey 令牌桶 key。同一 key 每分钟最多 5 次。
 *                            推荐用 reason（如 "tag.changed"），
 *                            这样连点保存会被合并，不会打爆速率限制。
 */
export async function purgeWorkersCache(
  ctx: WorkersCachePurgeContext,
  target: WorkersCachePurgeTarget,
  options: { throttleKey?: string } = {},
): Promise<void> {
  const throttleKey =
    options.throttleKey ??
    ("purgeEverything" in target
      ? "__everything__"
      : [...new Set(target.tags)].sort().join(","));

  if (!allowWrite(throttleKey, { limit: PURGE_LIMIT, windowMs: PURGE_WINDOW_MS })) {
    // 触发限流：跳过本次 purge，不阻塞主流程
    return;
  }

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
/**
 * 缓存写操作的统一节流/限流层。
 *
 * 背景：Cloudflare KV 免费套餐每天只有 1000 次 put / delete / list 配额，
 * 而编辑一篇文章会触发多个 entry 的缓存失效。用户连点保存时，
 * 高频的 KV delete 和 Workers Cache purge 都会迅速打爆配额或触发速率限制。
 *
 * 方案：
 * 1. 令牌桶（token bucket）按 bucketKey 限流：窗口内最多 N 次写。
 *    正常单次编辑不受影响，连点会被合并。
 * 2. key 级最小间隔节流：同一 key 在窗口内只写一次，避免重复 delete/put。
 */

// ---------- 令牌桶 ----------

type Bucket = number[];

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  /** 窗口内允许的最大次数 */
  limit?: number;
  /** 窗口大小（毫秒） */
  windowMs?: number;
};

/**
 * 令牌桶：bucketKey 在 windowMs 内最多允许 limit 次操作。
 * 返回 true 表示允许，false 表示被限流。
 */
export function allowWrite(
  bucketKey: string,
  { limit = 10, windowMs = 60_000 }: RateLimitOptions = {},
): boolean {
  const now = Date.now();
  const times = (buckets.get(bucketKey) ?? []).filter(
    (t) => now - t < windowMs,
  );

  if (times.length >= limit) {
    buckets.set(bucketKey, times);
    return false;
  }

  times.push(now);
  buckets.set(bucketKey, times);
  return true;
}

// ---------- key 级最小间隔节流 ----------

const lastWriteAt = new Map<string, number>();

/** 同一 key 在窗口内只写一次 */
const MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 是否应跳过这次写。
 * @param key 序列化后的 KV key
 * @param force 是否强制写入（跳过节流）
 */
export function shouldSkipWrite(key: string, force = false): boolean {
  if (force) {
    lastWriteAt.set(key, Date.now());
    return false;
  }

  const now = Date.now();
  const last = lastWriteAt.get(key) ?? 0;

  if (now - last < MIN_INTERVAL_MS) {
    return true;
  }

  lastWriteAt.set(key, now);
  return false;
}

/** 手动标记 key 已写入 */
export function markWritten(key: string): void {
  lastWriteAt.set(key, Date.now());
}

/**
 * 清理过期记录，避免 Map 无限增长。
 * 可以在请求收尾、定时任务或 cron trigger 中调用。
 */
export function pruneThrottle(olderThanMs = MIN_INTERVAL_MS * 2): void {
  const now = Date.now();

  const cutoff = now - olderThanMs;
  for (const [key, ts] of lastWriteAt) {
    if (ts < cutoff) lastWriteAt.delete(key);
  }

  const bucketCutoff = now - 10 * 60 * 1000;
  for (const [key, times] of buckets) {
    const kept = times.filter((t) => t > bucketCutoff);
    if (kept.length === 0) buckets.delete(key);
    else buckets.set(key, kept);
  }
}
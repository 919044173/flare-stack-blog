import { invalidate } from "@/features/cache/public-cache";
import * as CategoryRepo from "@/features/categories/data/categories.data";
import * as MediaRepo from "@/features/media/data/media.data";
import { syncPostMedia } from "@/features/posts/data/post-media.data";
import * as PostRevisionRepo from "@/features/posts/data/post-revisions.data";
import * as PostRepo from "@/features/posts/data/posts.data";
import { postBySlug } from "@/features/posts/posts.cache";
import type {
  CreatePostData,
  DeletePostInput,
  FindPostByIdInput,
  FindPostBySlugInput,
  GenerateSlugInput,
  GetPostsCountInput,
  GetPostsCursorInput,
  GetPostsInput,
  PublishPostInput,
  UnpublishPostInput,
  UpdatePostInput,
} from "@/features/posts/schema/posts.schema";
import {
  normalizePostCategoryName,
  normalizePostTagName,
} from "@/features/posts/schema/posts.schema";
import { toIsoOrNull } from "@/features/posts/public-snapshot";
import type { PublicPostCover } from "@/lib/db/schema";

import { slugify } from "@/features/posts/utils/content";
import { normalizePostContent } from "@/features/posts/utils/normalize-content";
import { serverUtcDateString } from "@/features/posts/utils/date";
import { calculatePostHash } from "@/features/posts/utils/sync";
import { generateTableOfContents } from "@/features/posts/utils/toc";
import * as SearchService from "@/features/search/service/search.service";
import type { PublicPostSnapshot } from "@/lib/db/schema";
import { err, ok } from "@/lib/errors";

function stripPublicSnapshot<
  T extends { publicSnapshotJson?: unknown; publicSlug?: unknown },
>(post: T): Omit<T, "publicSnapshotJson" | "publicSlug"> {
  const {
    publicSnapshotJson: _publicSnapshotJson,
    publicSlug: _publicSlug,
    ...rest
  } = post;
  return rest;
}

/**
 * 从 TipTap contentJson 里提取纯文本。
 * 段落之间用 "\n" 拼接，方便"取第一段"。
 */
function extractPlainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    return n.content.map(extractPlainText).join("\n");
  }
  return "";
}

/**
 * 从 TipTap contentJson 里提取第一张图片的 src。
 */
function extractFirstImageSrc(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as {
    type?: string;
    attrs?: { src?: string };
    content?: unknown[];
  };
  if (n.type === "image" && typeof n.attrs?.src === "string") {
    return n.attrs.src;
  }
  if (Array.isArray(n.content)) {
    for (const child of n.content) {
      const found = extractFirstImageSrc(child);
      if (found !== null) return found;
    }
  }
  return null;
}

/**
 * 从 "/images/xxx.webp" 里提取出 "xxx.webp"
 */
function extractMediaKeyFromSrc(src: string): string | null {
  const match = /\/images\/([^/?#]+)/.exec(src);
  return match?.[1] ?? null;
}

async function resolveSnapshotCover(
  db: DB,
  coverMediaId: number | null | undefined,
): Promise<PublicPostCover | null> {
  if (coverMediaId == null) return null;
  const media = await MediaRepo.findMediaById(db, coverMediaId);
  if (!media) return null;
  return {
    mediaId: media.id,
    key: media.key,
    url: media.url,
    width: media.width,
    height: media.height,
  };
}

function toAdminCover(
  media: NonNullable<Awaited<ReturnType<typeof MediaRepo.findMediaById>>>,
) {
  return {
    id: media.id,
    key: media.key,
    url: media.url,
    fileName: media.fileName,
    width: media.width,
    height: media.height,
  };
}

async function buildPublicSnapshot(
  db: DB,
  post: NonNullable<Awaited<ReturnType<typeof PostRepo.findPostById>>>,
  contentJson: PublicPostSnapshot["contentJson"],
): Promise<PublicPostSnapshot> {
  return {
    title: post.title,
    summary: post.summary,
    slug: post.slug,
    contentJson,
    tagIds: [...new Set(post.tags.map((tag) => tag.id))].sort((a, b) => a - b),
    categoryId: post.categoryId ?? null,
    publishedAt: toIsoOrNull(post.publishedAt) ?? new Date().toISOString(),
    pinnedAt: toIsoOrNull(post.pinnedAt),
    cover: await resolveSnapshotCover(db, post.coverMediaId),
  };
}

async function createPublishRevision(
  context: DbContext,
  post: NonNullable<Awaited<ReturnType<typeof PostRepo.findPostById>>>,
) {
  const tagIds = [...new Set(post.tags.map((tag) => tag.id))].sort(
    (a, b) => a - b,
  );
  const snapshotHash = await calculatePostHash({
    title: post.title,
    contentJson: post.contentJson,
    summary: post.summary,
    tagIds,
    slug: post.slug,
    publishedAt: post.publishedAt,
    pinnedAt: post.pinnedAt,
    coverMediaId: post.coverMediaId,
    categoryId: post.categoryId ?? null,
  });

  const latestPublish = await PostRevisionRepo.findLatestPostRevision(
    context.db,
    post.id,
    { reason: "publish" },
  );
  if (latestPublish?.snapshotHash === snapshotHash) {
    return;
  }

  await PostRevisionRepo.insertPostRevision(context.db, {
    postId: post.id,
    reason: "publish",
    snapshotHash,
    snapshotJson: {
      title: post.title,
      summary: post.summary,
      slug: post.slug,
      status: "published",
      publishedAt: toIsoOrNull(post.publishedAt),
      contentJson: post.contentJson,
      tagIds,
      categoryId: post.categoryId ?? null,
      coverMediaId: post.coverMediaId ?? null,
    },
  });
}

/**
 * 根据"是否动态"，自动处理摘要 + 封面。
 * - 动态：摘要 = 正文第一段的前 120 字（超长则加 "......"）
 * - 封面：如果"不是手动设的"，则 = 正文第一张图
 */
async function applyAutoFields(
  context: DbContext,
  post: NonNullable<Awaited<ReturnType<typeof PostRepo.findPostById>>>,
): Promise<{ summary?: string; coverMediaId?: number }> {
  const updates: { summary?: string; coverMediaId?: number } = {};

  // ✅ 摘要：只对"动态"生效
  const isMoment = post.category?.name === "动态";
  if (isMoment && post.contentJson) {
    // 1. 提取纯文本（段落之间加 "\n"）
    const rawText = extractPlainText(post.contentJson);
    // 2. 只取"第一段"
    const firstParagraph = rawText.split("\n")[0] ?? "";
    // 3. 判断"第一段是否超过 120 字"
    const isTruncated = firstParagraph.length > 120;
    // 4. 截断到 120 字
    const truncated = firstParagraph.slice(0, 120).trim();
    // 5. 如果"被截断"，末尾加 "......"
    const excerpt = isTruncated ? `${truncated}......` : truncated;

    if (excerpt && excerpt !== post.summary) {
      updates.summary = excerpt;
    }
  }

  // ✅ 封面：如果"不是手动设的"，则自动同步"正文第一张图"
  if (!post.coverIsManual && post.contentJson) {
    const firstImageSrc = extractFirstImageSrc(post.contentJson);
    if (firstImageSrc) {
      const mediaKey = extractMediaKeyFromSrc(firstImageSrc);
      if (mediaKey) {
        const media = await MediaRepo.findMediaByKey(context.db, mediaKey);
        if (media && media.id !== post.coverMediaId) {
          updates.coverMediaId = media.id;
        }
      }
    }
  }

  return updates;
}

export function getHomePosts(context: DbContext, page: number) {
  return PostRepo.getHomePosts(context.db, page);
}

export async function getPinnedPosts(context: DbContext) {
  return PostRepo.findPinnedPosts(context.db);
}

export async function getPostsCursor(
  context: DbContext,
  data: GetPostsCursorInput,
) {
  const tagName = normalizePostTagName(data.tagName);
  const categoryName = normalizePostCategoryName(data.categoryName);
  return PostRepo.getPostsCursor(context.db, {
    limit: data.limit ?? 10,
    cursor: data.cursor ?? 0,
    tagName,
    categoryName,
    uncategorized: data.uncategorized,
    excludePinned: data.excludePinned,
    publicOnly: true,
  });
}

export async function findPostBySlug(
  context: DbContext & { executionCtx: ExecutionContext },
  data: FindPostBySlugInput,
) {
  return postBySlug.get(context, { slug: data.slug });
}

export async function getAdjacentPosts(
  context: DbContext,
  data: FindPostBySlugInput,
) {
  return PostRepo.findAdjacentPublicPosts(context.db, data.slug);
}

export async function generateSlug(
  context: DbContext,
  data: GenerateSlugInput,
) {
  const baseSlug = slugify(data.title);
  const exactMatch = await PostRepo.slugExists(context.db, baseSlug, {
    excludeId: data.excludeId,
  });
  if (!exactMatch) {
    return { slug: baseSlug };
  }

  const similarSlugs = await PostRepo.findSimilarSlugs(context.db, baseSlug, {
    excludeId: data.excludeId,
  });

  const regex = new RegExp(`^${baseSlug}-(\\d+)$`);

  let maxSuffix = 0;
  for (const slug of similarSlugs) {
    const match = slug.match(regex);
    if (match) {
      const number = parseInt(match[1], 10);
      if (number > maxSuffix) {
        maxSuffix = number;
      }
    }
  }

  return { slug: `${baseSlug}-${maxSuffix + 1}` };
}

const SLUG_CONFLICT_PATTERN = /UNIQUE constraint failed:\s*posts\.slug/i;
const SLUG_INSERT_ATTEMPTS = 5;
const SLUG_DERIVED_ATTEMPTS = 2;

function isSlugConflict(error: unknown) {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (SLUG_CONFLICT_PATTERN.test(current.message)) return true;
  }
  return false;
}

function randomSlugSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

async function insertDraftWithGeneratedSlug(
  context: DbContext,
  title: string,
  values: Omit<Parameters<typeof PostRepo.insertPost>[1], "slug">,
) {
  for (let attempt = 1; ; attempt += 1) {
    const { slug } = await generateSlug(context, { title });
    const candidate =
      attempt <= SLUG_DERIVED_ATTEMPTS ? slug : `${slug}-${randomSlugSuffix()}`;
    try {
      return await PostRepo.insertPost(context.db, {
        ...values,
        slug: candidate,
      });
    } catch (error) {
      if (attempt >= SLUG_INSERT_ATTEMPTS || !isSlugConflict(error))
        throw error;
    }
  }
}

export async function createDraft(context: DbContext, data: CreatePostData) {
  const post = await insertDraftWithGeneratedSlug(context, data.title, {
    title: data.title,
    summary: data.summary ?? null,
    status: "draft",
    contentJson: normalizePostContent(data.contentJson ?? null),
  });

  await syncPostMedia(context.db, post);

  return { id: post.id };
}

export async function createEmptyPost(context: DbContext) {
  try {
    const existing = await PostRepo.findReusableEmptyDraft(context.db);
    if (existing) {
      return { id: existing.id };
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "reuse_empty_draft_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  const post = await insertDraftWithGeneratedSlug(context, "", {
    title: "",
    summary: "",
    status: "draft",
    contentJson: null,
  });

  return { id: post.id };
}

export async function listAdminPostsPage(
  context: DbContext,
  data: GetPostsInput,
) {
  const [items, statusCounts] = await Promise.all([
    getPosts(context, data),
    PostRepo.getAdminPostStatusCounts(context.db, {
      publicOnly: data.publicOnly,
      search: data.search,
      taxonomy: data.taxonomy,
      excludeCategoryName: data.excludeCategoryName,
    }),
  ]);
  const total =
    data.status === "draft"
      ? statusCounts.draft
      : data.status === "published"
        ? statusCounts.published
        : data.status
          ? 0
          : statusCounts.draft + statusCounts.published;
  return { items, total, statusCounts };
}

export async function getPosts(context: DbContext, data: GetPostsInput) {
  return await PostRepo.getPosts(context.db, {
    offset: data.offset ?? 0,
    limit: data.limit ?? 10,
    status: data.status,
    publicOnly: data.publicOnly,
    search: data.search,
    taxonomy: data.taxonomy,
    excludeCategoryName: data.excludeCategoryName,
    sortDir: data.sortDir,
    sortBy: data.sortBy,
    includeContent: data.includeContent,
  });
}

export async function getPostsCount(
  context: DbContext,
  data: GetPostsCountInput,
) {
  return await PostRepo.getPostsCount(context.db, {
    status: data.status,
    publicOnly: data.publicOnly,
    search: data.search,
    taxonomy: data.taxonomy,
    excludeCategoryName: data.excludeCategoryName,
  });
}

export async function findPostBySlugAdmin(
  context: DbContext,
  data: FindPostBySlugInput,
) {
  const post = await PostRepo.findPostBySlug(context.db, data.slug, {
    publicOnly: false,
  });
  if (!post) return null;
  return {
    ...stripPublicSnapshot(post),
    toc: generateTableOfContents(post.contentJson),
  };
}

export async function findPostById(
  context: DbContext,
  data: FindPostByIdInput,
) {
  const post = await PostRepo.findPostById(context.db, data.id);
  if (!post) return null;

  const coverMedia =
    post.coverMediaId == null
      ? null
      : await MediaRepo.findMediaById(context.db, post.coverMediaId);

  return {
    ...stripPublicSnapshot(post),
    coverMediaId: coverMedia ? post.coverMediaId : null,
    cover: coverMedia ? toAdminCover(coverMedia) : null,
    hasPublicSnapshot: post.publicSnapshotJson != null,
    publicSnapshotContentJson: post.publicSnapshotJson?.contentJson ?? null,
    serverToday: serverUtcDateString(),
  };
}

export async function updatePost(
  context: DbContext & { executionCtx: ExecutionContext; env?: Env },
  data: UpdatePostInput,
) {
  if (data.data.coverMediaId != null) {
    const coverMedia = await MediaRepo.findMediaById(
      context.db,
      data.data.coverMediaId,
    );
    if (!coverMedia) {
      return err({ reason: "MEDIA_NOT_FOUND" });
    }
  }

  if (data.data.categoryId != null) {
    const category = await CategoryRepo.findCategoryById(
      context.db,
      data.data.categoryId,
    );
    if (!category) {
      return err({ reason: "CATEGORY_NOT_FOUND" });
    }
  }

  const updateData =
    data.data.contentJson !== undefined
      ? {
          ...data.data,
          contentJson: normalizePostContent(data.data.contentJson),
        }
      : data.data;
  const updatedPost = await PostRepo.updatePost(
    context.db,
    data.id,
    updateData,
  );
  if (!updatedPost) {
    return err({ reason: "POST_NOT_FOUND" });
  }

  if (
    updateData.contentJson !== undefined ||
    updateData.coverMediaId !== undefined
  ) {
    await syncPostMedia(context.db, updatedPost);
  }

  if (updateData.categoryId !== undefined && updatedPost.publicSnapshotJson) {
    context.executionCtx.waitUntil(
      invalidate.categoryChanged(context, {
        slugs: [updatedPost.publicSnapshotJson.slug],
      }),
    );
  }
  return ok(stripPublicSnapshot(updatedPost));
}

export async function deletePost(
  context: DbContext & { executionCtx: ExecutionContext },
  data: DeletePostInput,
) {
  const post = await PostRepo.findPostById(context.db, data.id);
  if (!post) {
    return err({ reason: "POST_NOT_FOUND" });
  }

  await PostRepo.deletePost(context.db, data.id);

  const publicSlug = post.publicSlug ?? post.publicSnapshotJson?.slug;
  if (publicSlug) {
    await SearchService.deleteIndex(context, { id: data.id });
    await invalidate.postDeleted(context, { slug: publicSlug });
  }

  return ok({ success: true });
}

export async function publishPost(
  context: DbContext & { executionCtx: ExecutionContext },
  data: PublishPostInput,
) {
  const post = await PostRepo.findPostById(context.db, data.id);
  if (!post) {
    return err({ reason: "POST_NOT_FOUND" });
  }

  // ✅ 首次发布：填当前时刻；重新发布：保留原发布时间
  const normalizedContent = normalizePostContent(post.contentJson);
  const isFirstPublish = !post.publishedAt;
  const publishedAt = isFirstPublish ? new Date() : post.publishedAt;

  // ✅ 自动处理"摘要" + "封面"
  const autoFields = await applyAutoFields(context, {
    ...post,
    contentJson: normalizedContent ?? post.contentJson,
  });

  await PostRepo.updatePost(context.db, post.id, {
    ...(isFirstPublish ? { publishedAt } : {}),
    ...(normalizedContent ? { contentJson: normalizedContent } : {}),
    ...autoFields,
  });

  const freshPost = await PostRepo.findPostById(context.db, post.id);
  if (!freshPost) {
    return err({ reason: "POST_NOT_FOUND" });
  }

  const publishedPost = {
    ...freshPost,
    publishedAt,
    ...autoFields,
  };

  const slugTaken = await PostRepo.publicSlugExists(
    context.db,
    publishedPost.slug,
    { excludeId: publishedPost.id },
  );
  if (slugTaken) {
    return err({ reason: "PUBLIC_SLUG_TAKEN" });
  }

  await createPublishRevision(context, publishedPost);

  const { highlightSnapshotContent } =
    await import("@/features/posts/utils/highlight-code-blocks");
  const snapshotContent = await highlightSnapshotContent(
    publishedPost.contentJson,
    publishedPost.publicSnapshotJson?.contentJson,
  );
  const snapshot = await buildPublicSnapshot(
    context.db,
    publishedPost,
    snapshotContent,
  );
  const previousPublicSlug = publishedPost.publicSlug;
  const published = await PostRepo.writePublicSnapshot(
    context.db,
    publishedPost.id,
    snapshot,
  );
  if (!published) {
    return err({ reason: "POST_NOT_FOUND" });
  }
  await syncPostMedia(context.db, published);

  await SearchService.upsert(context, {
    id: publishedPost.id,
    slug: snapshot.slug,
    title: snapshot.title,
    summary: snapshot.summary,
    contentJson: snapshotContent,
    tags: publishedPost.tags.map((tag) => tag.name),
    category: publishedPost.category?.name ?? null,
  });

  if (previousPublicSlug && previousPublicSlug !== snapshot.slug) {
    await invalidate.postDeleted(context, { slug: previousPublicSlug });
  }
  await invalidate.postPublished(context, { slug: snapshot.slug });

  return ok({ success: true });
}

export async function unpublishPost(
  context: DbContext & { executionCtx: ExecutionContext },
  data: UnpublishPostInput,
) {
  const post = await PostRepo.findPostById(context.db, data.id);
  if (!post) {
    return err({ reason: "POST_NOT_FOUND" });
  }

  const publicSlug =
    post.publicSlug ?? post.publicSnapshotJson?.slug ?? post.slug;
  const unpublished = await PostRepo.clearPublicSnapshot(context.db, post.id);
  if (!unpublished) {
    return err({ reason: "POST_NOT_FOUND" });
  }
  await syncPostMedia(context.db, unpublished);
  await SearchService.deleteIndex(context, { id: post.id });
  await invalidate.postDeleted(context, { slug: publicSlug });

  return ok({ success: true });
}
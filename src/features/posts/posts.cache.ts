import { defineEntry } from "@/features/cache/public-cache";
import * as PostRepo from "@/features/posts/data/posts.data";
import { PostWithTocSchema } from "@/features/posts/schema/posts.schema";
import { toPublicCover } from "@/features/posts/public-snapshot";
import { estimateReadTimeMinutes } from "@/features/posts/utils/content";
import { generateTableOfContents } from "@/features/posts/utils/toc";

const POST_PUBLIC_REASONS = [
  "post.published",
  "post.deleted",
  "tag.changed",
  "category.changed",
] as const;

/**
 * 只保留详情页缓存。
 *
 * 首页 / 置顶 / 热门 / 列表 均不再使用 KV 缓存：
 * - D1 查询本身很快（个人博客场景）
 * - 避免 bump 机制产生孤儿 key
 * - 内容实时生效，不再有 TTL 延迟
 */
export const postBySlug = defineEntry({
  name: "posts.detail",
  namespace: "posts:detail",
  address: ["slug"],
  key: ({ slug }: { slug: string }) => ["post", slug],
  schema: PostWithTocSchema,
  ttl: "7d",
  invalidatedBy: POST_PUBLIC_REASONS,
  load: async (context, { slug }) => {
    const post = await PostRepo.findPostBySlug(context.db, slug, {
      publicOnly: true,
    });
    if (!post) return null;

    return {
      id: post.id,
      title: post.title,
      summary: post.summary,
      slug: post.slug,
      status: "published" as const,
      publishedAt: post.publishedAt,
      pinnedAt: post.pinnedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      contentJson: post.contentJson,
      readTimeInMinutes: estimateReadTimeMinutes(post.contentJson),
      tags: post.tags,
      category: "category" in post ? (post.category ?? null) : null,
      toc: generateTableOfContents(post.contentJson),
      cover: toPublicCover(post.publicSnapshotJson?.cover),
    };
  },
});
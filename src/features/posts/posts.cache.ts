import { eq } from "drizzle-orm";
import { defineEntry } from "@/features/cache/public-cache";
import * as PostRepo from "@/features/posts/data/posts.data";
import { PostWithTocSchema } from "@/features/posts/schema/posts.schema";
import { toPublicCover } from "@/features/posts/public-snapshot";
import { estimateReadTimeMinutes } from "@/features/posts/utils/content";
import { generateTableOfContents } from "@/features/posts/utils/toc";
import { PostsTable } from "@/lib/db/schema";

const POST_PUBLIC_REASONS = [
  "post.published",
  "post.deleted",
  "tag.changed",
  "category.changed",
] as const;

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

    // ✅ 额外查 coverIsManual（因为 snapshot 里没这个字段）
    const rawPost = await context.db.query.PostsTable.findFirst({
      where: eq(PostsTable.publicSlug, slug),
      columns: { coverIsManual: true },
    });

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
      coverIsManual: rawPost?.coverIsManual ?? false,
    };
  },
});
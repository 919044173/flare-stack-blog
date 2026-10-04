import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, ne, or, sql } from "drizzle-orm";
import type { PostStatus } from "@/lib/db/schema";
import type { AdminTaxonomyFilter } from "@/features/posts/schema/posts.schema";
import { PostTagsTable, PostsTable } from "@/lib/db/schema";

export type SortField = "publishedAt" | "updatedAt" | "id";
export type SortDirection = "ASC" | "DESC";

function escapeLikeString(str: string) {
  return str.replace(/[%_\\]/g, "\\$&");
}

export function adminPostTextColumns(taxonomy?: AdminTaxonomyFilter) {
  if (taxonomy?.scope !== "public")
    return {
      title: PostsTable.title,
      summary: PostsTable.summary,
      slug: PostsTable.slug,
    };
  return {
    title: sql<string>`coalesce(json_extract(${PostsTable.publicSnapshotJson}, '$.title'), ${PostsTable.title})`,
    summary: sql<
      string | null
    >`json_extract(${PostsTable.publicSnapshotJson}, '$.summary')`,
    slug: sql<string>`coalesce(json_extract(${PostsTable.publicSnapshotJson}, '$.slug'), ${PostsTable.publicSlug}, ${PostsTable.slug})`,
  };
}

function taxonomyWhereClause(taxonomy: AdminTaxonomyFilter): SQL {
  if (taxonomy.kind === "category")
    return eq(PostsTable.categoryId, taxonomy.id);
  if (taxonomy.kind === "uncategorized")
    return sql`${PostsTable.categoryId} IS NULL`;
  return sql`EXISTS (SELECT 1 FROM ${PostTagsTable} WHERE ${PostTagsTable.postId} = ${PostsTable.id} AND ${PostTagsTable.tagId} = ${taxonomy.id})`;
}

export function buildPostWhereClause(options: {
  status?: PostStatus;
  publicOnly?: boolean;
  search?: string;
  taxonomy?: AdminTaxonomyFilter;
  excludeCategoryId?: number;   // ✅ 新增
}) {
  const whereClauses = [];
  if (options.taxonomy)
    whereClauses.push(taxonomyWhereClause(options.taxonomy));

  // ✅ 排除某个分类（分类为空的文章保留）
  if (options.excludeCategoryId != null) {
    whereClauses.push(
      or(
        ne(PostsTable.categoryId, options.excludeCategoryId),
        sql`${PostsTable.categoryId} IS NULL`,
      )!,
    );
  }

  if (options.status) {
    whereClauses.push(eq(PostsTable.status, options.status));
  }

  if (options.publicOnly || options.taxonomy?.scope === "public") {
    whereClauses.push(sql`${PostsTable.publicSnapshotJson} IS NOT NULL`);
  }

  if (options.search) {
    const searchTerm = options.search.trim();
    if (searchTerm) {
      const pattern = `%${escapeLikeString(searchTerm)}%`;
      const fields = adminPostTextColumns(options.taxonomy);
      whereClauses.push(
        or(
          sql`${fields.title} LIKE ${pattern} ESCAPE '\\'`,
          sql`${fields.summary} LIKE ${pattern} ESCAPE '\\'`,
          sql`${fields.slug} LIKE ${pattern} ESCAPE '\\'`,
        ),
      );
    }
  }

  return whereClauses.length > 0 ? and(...whereClauses) : undefined;
}

export function buildPostOrderByClause(
  sortDir?: SortDirection,
  sortBy?: SortField,
  publicSnapshot = false,
): SQL[] {
  const direction = sortDir ?? "DESC";
  const field = sortBy ?? "updatedAt";
  const orderFn = direction === "DESC" ? desc : asc;
  const primary = orderFn(
    publicSnapshot && field === "publishedAt"
      ? sql`json_extract(${PostsTable.publicSnapshotJson}, '$.publishedAt')`
      : PostsTable[field],
  );
  return field === "id" ? [primary] : [primary, orderFn(PostsTable.id)];
}
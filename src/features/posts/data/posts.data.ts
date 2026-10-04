import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  like,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { SortDirection, SortField } from "@/features/posts/data/helper";
import {
  adminPostTextColumns,
  buildPostOrderByClause,
  buildPostWhereClause,
} from "@/features/posts/data/helper";
import { mapSnapshotToPublicPost } from "@/features/posts/public-snapshot";
import type {
  AdminTaxonomyFilter,
  PostItem,
} from "@/features/posts/schema/posts.schema";
import { HOME_POSTS_PER_PAGE } from "@/features/posts/schema/posts.schema";
import { isPostBodyEmpty } from "@/features/posts/utils/is-post-body-empty";
import type { PostStatus, PublicPostSnapshot } from "@/lib/db/schema";
import {
  CategoriesTable,
  MediaTable,
  PostsTable,
  PostTagsTable,
  TagsTable,
} from "@/lib/db/schema";

const DEFAULT_PAGE_SIZE = 12;
const DEFAULT_SITEMAP_BATCH_SIZE = 500;

const snapshotPublishedAt = sql<string>`json_extract(${PostsTable.publicSnapshotJson}, '$.publishedAt')`;
const snapshotPinnedAt = sql<string>`json_extract(${PostsTable.publicSnapshotJson}, '$.pinnedAt')`;

async function hydratePublicPosts(
  db: DB,
  rows: Array<{
    id: number;
    status: PostStatus;
    createdAt: Date;
    updatedAt: Date;
    publicSnapshotJson: PublicPostSnapshot | null;
  }>,
): Promise<Array<PostItem>> {
  if (rows.length === 0) return [];
  const assignments = await db.query.PostsTable.findMany({
    columns: { id: true },
    where: inArray(
      PostsTable.id,
      rows.map((row) => row.id),
    ),
    with: { category: true, postTags: { with: { tag: true } } },
  });
  const byId = new Map(assignments.map((post) => [post.id, post]));
  return rows.flatMap((row) => {
    const assignment = byId.get(row.id);
    const item = mapSnapshotToPublicPost(
      row,
      assignment?.postTags.map(({ tag }) => tag) ?? [],
      assignment?.category
        ? { id: assignment.category.id, name: assignment.category.name }
        : null,
    );
    return item ? [item] : [];
  });
}

export type SitemapPostRow = {
  id: number;
  slug: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  publishedAt: Date | null;
};

export async function insertPost(db: DB, data: typeof PostsTable.$inferInsert) {
  const [post] = await db.insert(PostsTable).values(data).returning();
  return post;
}

export async function getPosts(
  db: DB,
  options: {
    offset?: number;
    limit?: number;
    status?: PostStatus;
    publicOnly?: boolean;
    search?: string;
    taxonomy?: AdminTaxonomyFilter;
    excludeCategoryName?: string;
    sortDir?: SortDirection;
    sortBy?: SortField;
    includeContent?: boolean;
  } = {},
) {
  const {
    offset = 0,
    limit = DEFAULT_PAGE_SIZE,
    sortDir,
    sortBy,
    includeContent = false,
    excludeCategoryName,
    ...filters
  } = options;

  // 排除分类
  let excludeCategoryId: number | undefined;
  if (excludeCategoryName) {
    const category = await db.query.CategoriesTable.findFirst({
      where: eq(CategoriesTable.name, excludeCategoryName),
      columns: { id: true },
    });
    excludeCategoryId = category?.id;
  }

  const whereClause = buildPostWhereClause({ ...filters, excludeCategoryId });
  const publicScope = filters.taxonomy?.scope === "public";
  const orderByClause = buildPostOrderByClause(sortDir, sortBy, publicScope);
  const snapshotDate = (field: "publishedAt" | "pinnedAt") =>
    sql<
      string | null
    >`json_extract(${PostsTable.publicSnapshotJson}, ${`$.${field}`})`.mapWith(
      (value) => (value == null ? null : new Date(value)),
    );

  const rows = await db
    .select({
      id: PostsTable.id,
      ...adminPostTextColumns(filters.taxonomy),
      status: PostsTable.status,
      publishedAt: publicScope
        ? snapshotDate("publishedAt")
        : PostsTable.publishedAt,
      pinnedAt: publicScope ? snapshotDate("pinnedAt") : PostsTable.pinnedAt,
      categoryId: PostsTable.categoryId,
      createdAt: PostsTable.createdAt,
      updatedAt: PostsTable.updatedAt,
      coverMediaId: PostsTable.coverMediaId,
      ...(includeContent && !publicScope
        ? { contentJson: PostsTable.contentJson }
        : {}),
    })
    .from(PostsTable)
    .limit(Math.min(limit, 50))
    .offset(offset)
    .orderBy(...orderByClause)
    .where(whereClause);

  // ✅ 批量查封面 media
  const coverIds = rows
    .map((row) => row.coverMediaId)
    .filter((id): id is number => id != null);

  const coverById = new Map<
    number,
    {
      id: number;
      key: string;
      url: string;
      fileName: string;
      width: number | null;
      height: number | null;
    }
  >();
  if (coverIds.length > 0) {
    const medias = await db.query.MediaTable.findMany({
      where: inArray(MediaTable.id, coverIds),
    });
    for (const media of medias) {
      coverById.set(media.id, {
        id: media.id,
        key: media.key,
        url: media.url,
        fileName: media.fileName,
        width: media.width,
        height: media.height,
      });
    }
  }

  // ✅ 挂 cover
  return rows.map((row) => ({
    ...row,
    cover:
      row.coverMediaId != null
        ? coverById.get(row.coverMediaId) ?? null
        : null,
  }));
}

export async function getPostsCount(
  db: DB,
  options: {
    status?: PostStatus;
    publicOnly?: boolean;
    search?: string;
    taxonomy?: AdminTaxonomyFilter;
    excludeCategoryName?: string;
  } = {},
) {
  const { excludeCategoryName, ...filters } = options;

  let excludeCategoryId: number | undefined;
  if (excludeCategoryName) {
    const category = await db.query.CategoriesTable.findFirst({
      where: eq(CategoriesTable.name, excludeCategoryName),
      columns: { id: true },
    });
    excludeCategoryId = category?.id;
  }

  const whereClause = buildPostWhereClause({ ...filters, excludeCategoryId });
  const totalNumberofPosts = await db
    .select({ count: count() })
    .from(PostsTable)
    .where(whereClause);
  return totalNumberofPosts[0].count;
}

export async function getAdminPostStatusCounts(
  db: DB,
  options: {
    publicOnly?: boolean;
    search?: string;
    taxonomy?: AdminTaxonomyFilter;
    excludeCategoryName?: string;
  } = {},
) {
  const { excludeCategoryName, ...filters } = options;

  let excludeCategoryId: number | undefined;
  if (excludeCategoryName) {
    const category = await db.query.CategoriesTable.findFirst({
      where: eq(CategoriesTable.name, excludeCategoryName),
      columns: { id: true },
    });
    excludeCategoryId = category?.id;
  }

  const rows = await db
    .select({ status: PostsTable.status, count: count() })
    .from(PostsTable)
    .where(buildPostWhereClause({ ...filters, excludeCategoryId }))
    .groupBy(PostsTable.status);
  return {
    draft: rows.find((row) => row.status === "draft")?.count ?? 0,
    published: rows.find((row) => row.status === "published")?.count ?? 0,
  };
}

export async function findReusableEmptyDraft(db: DB) {
  const rows = await db
    .select({
      id: PostsTable.id,
      contentJson: PostsTable.contentJson,
    })
    .from(PostsTable)
    .where(
      and(eq(PostsTable.status, "draft"), sql`trim(${PostsTable.title}) = ''`),
    )
    .orderBy(desc(PostsTable.updatedAt))
    .limit(20);

  for (const row of rows) {
    if (isPostBodyEmpty(row.contentJson)) {
      return row;
    }
  }
  return null;
}

export async function getPostsCursor(
  db: DB,
  options: {
    cursor?: number;
    limit?: number;
    publicOnly?: boolean;
    tagName?: string;
    categoryName?: string;
    uncategorized?: boolean;
    excludePinned?: boolean;
  } = {},
): Promise<{
  items: Array<PostItem>;
  nextCursor: number | null;
}> {
  const {
    cursor,
    limit = DEFAULT_PAGE_SIZE,
    publicOnly = true,
    tagName,
    categoryName,
    uncategorized,
    excludePinned,
  } = options;

  const conditions = [];
  const baseConditions = buildPostWhereClause({ publicOnly });
  if (baseConditions) {
    conditions.push(baseConditions);
  }

  if (cursor) {
    const reference = await db.query.PostsTable.findFirst({
      where: eq(PostsTable.id, cursor),
      columns: { publicSnapshotJson: true, id: true },
    });
    const referencePublishedAt = reference?.publicSnapshotJson?.publishedAt;

    if (referencePublishedAt) {
      conditions.push(
        or(
          lt(snapshotPublishedAt, referencePublishedAt),
          and(
            eq(snapshotPublishedAt, referencePublishedAt),
            lt(PostsTable.id, reference.id),
          ),
        ),
      );
    } else if (reference) {
      conditions.push(lt(PostsTable.id, cursor));
    }
  }

  if (tagName) {
    conditions.push(
      sql`EXISTS (
        SELECT 1
        FROM ${PostTagsTable}
        JOIN ${TagsTable} ON ${TagsTable.id} = ${PostTagsTable.tagId}
        WHERE ${PostTagsTable.postId} = ${PostsTable.id} AND ${TagsTable.name} = ${tagName}
      )`,
    );
  }

  if (uncategorized) {
    conditions.push(sql`${PostsTable.categoryId} IS NULL`);
  } else if (categoryName) {
    conditions.push(
      sql`EXISTS (
        SELECT 1
        FROM ${CategoriesTable}
        WHERE ${CategoriesTable.id} = ${PostsTable.categoryId}
          AND ${CategoriesTable.name} = ${categoryName}
      )`,
    );
  }

  if (excludePinned) {
    conditions.push(sql`${snapshotPinnedAt} IS NULL`);
  }

  const itemsWithPotentialNext = await db
    .select({
      id: PostsTable.id,
      status: PostsTable.status,
      createdAt: PostsTable.createdAt,
      updatedAt: PostsTable.updatedAt,
      publicSnapshotJson: PostsTable.publicSnapshotJson,
    })
    .from(PostsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(snapshotPublishedAt), desc(PostsTable.id))
    .limit(limit + 1);

  const hasMore = itemsWithPotentialNext.length > limit;
  const rows = itemsWithPotentialNext.slice(0, limit);
  const items = await hydratePublicPosts(db, rows);
  const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

  return { items, nextCursor };
}

export async function getHomePosts(db: DB, requestedPage: number) {
  const dynamicsCategory = await db.query.CategoriesTable.findFirst({
    where: eq(CategoriesTable.name, "动态"),
    columns: { id: true },
  });

  const baseConditions = [sql`${PostsTable.publicSnapshotJson} IS NOT NULL`];
  if (dynamicsCategory) {
    baseConditions.push(
      or(
        ne(PostsTable.categoryId, dynamicsCategory.id),
        sql`${PostsTable.categoryId} IS NULL`,
      )!,
    );
  }
  const homeWhere = and(...baseConditions);

  const totalResult = await db
    .select({ count: count() })
    .from(PostsTable)
    .where(homeWhere);
  const total = totalResult[0]?.count ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / HOME_POSTS_PER_PAGE));
  const page = Math.min(requestedPage, totalPages);

  const rows = await db
    .select({
      id: PostsTable.id,
      status: PostsTable.status,
      createdAt: PostsTable.createdAt,
      updatedAt: PostsTable.updatedAt,
      publicSnapshotJson: PostsTable.publicSnapshotJson,
    })
    .from(PostsTable)
    .where(homeWhere)
    .orderBy(
      desc(snapshotPinnedAt),
      desc(snapshotPublishedAt),
      desc(PostsTable.id),
    )
    .limit(HOME_POSTS_PER_PAGE)
    .offset((page - 1) * HOME_POSTS_PER_PAGE);

  return { items: await hydratePublicPosts(db, rows), page, totalPages };
}

export async function getPublishedPostsForSitemapBatch(
  db: DB,
  options: {
    cursor?: {
      publishedAt: Date;
      id: number;
    };
    limit?: number;
  } = {},
): Promise<Array<SitemapPostRow>> {
  const { cursor, limit = DEFAULT_SITEMAP_BATCH_SIZE } = options;

  const cursorPublishedAt = cursor?.publishedAt.toISOString();
  const rows = await db
    .select({
      id: PostsTable.id,
      publicSlug: PostsTable.publicSlug,
      createdAt: PostsTable.createdAt,
      updatedAt: PostsTable.updatedAt,
      publicSnapshotJson: PostsTable.publicSnapshotJson,
    })
    .from(PostsTable)
    .where(
      and(
        isNotNull(PostsTable.publicSnapshotJson),
        cursor && cursorPublishedAt
          ? or(
              lt(snapshotPublishedAt, cursorPublishedAt),
              and(
                eq(snapshotPublishedAt, cursorPublishedAt),
                lt(PostsTable.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(snapshotPublishedAt), desc(PostsTable.id))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    slug: row.publicSlug ?? row.publicSnapshotJson?.slug ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publicSnapshotJson
      ? new Date(row.publicSnapshotJson.publishedAt)
      : null,
  }));
}

export async function findPostById(db: DB, id: number) {
  const post = await db.query.PostsTable.findFirst({
    where: eq(PostsTable.id, id),
    with: {
      postTags: {
        with: {
          tag: true,
        },
      },
      category: true,
    },
  });

  if (!post) return null;

  const tags = post.postTags.map((pt) => pt.tag);
  const { postTags, ...rest } = post;
  return { ...rest, tags };
}

export async function findPinnedPosts(db: DB) {
  const rows = await db
    .select({
      id: PostsTable.id,
      status: PostsTable.status,
      createdAt: PostsTable.createdAt,
      updatedAt: PostsTable.updatedAt,
      publicSnapshotJson: PostsTable.publicSnapshotJson,
    })
    .from(PostsTable)
    .where(
      and(
        isNotNull(PostsTable.publicSnapshotJson),
        sql`${snapshotPinnedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(snapshotPinnedAt));

  return hydratePublicPosts(db, rows);
}

export async function findPostsByIds(db: DB, ids: number[]) {
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      id: PostsTable.id,
      status: PostsTable.status,
      createdAt: PostsTable.createdAt,
      updatedAt: PostsTable.updatedAt,
      publicSnapshotJson: PostsTable.publicSnapshotJson,
    })
    .from(PostsTable)
    .where(
      and(
        isNotNull(PostsTable.publicSnapshotJson),
        inArray(PostsTable.id, ids),
      ),
    );

  return hydratePublicPosts(db, rows);
}

export async function findPostBySlug(
  db: DB,
  slug: string,
  options: { publicOnly?: boolean } = {},
) {
  const { publicOnly = false } = options;

  if (publicOnly) {
    const row = await db.query.PostsTable.findFirst({
      where: and(
        eq(PostsTable.publicSlug, slug),
        isNotNull(PostsTable.publicSnapshotJson),
      ),
    });
    if (!row?.publicSnapshotJson) return null;
    const [item] = await hydratePublicPosts(db, [row]);
    return item
      ? {
          ...row,
          ...item,
          contentJson: row.publicSnapshotJson.contentJson,
          tags: item.tags ?? [],
        }
      : null;
  }

  const post = await db.query.PostsTable.findFirst({
    where: eq(PostsTable.slug, slug),
    with: {
      postTags: {
        with: {
          tag: true,
        },
      },
    },
  });

  if (!post) return null;

  const tags = post.postTags.map((pt) => pt.tag);
  const { postTags, ...rest } = post;
  return { ...rest, tags };
}

export async function updatePost(
  db: DB,
  id: number,
  data: Partial<Omit<typeof PostsTable.$inferInsert, "id" | "createdAt">>,
) {
  await db.update(PostsTable).set(data).where(eq(PostsTable.id, id));
  return await findPostById(db, id);
}

export async function touchPostUpdatedAt(db: DB, id: number) {
  const [post] = await db
    .update(PostsTable)
    .set({ updatedAt: new Date() })
    .where(eq(PostsTable.id, id))
    .returning({ publicSlug: PostsTable.publicSlug });
  return post;
}

export async function writePublicSnapshot(
  db: DB,
  id: number,
  snapshot: PublicPostSnapshot,
) {
  await db
    .update(PostsTable)
    .set({
      publicSnapshotJson: snapshot,
      publicSlug: snapshot.slug,
      status: "published",
      updatedAt: sql`${PostsTable.updatedAt}`,
    })
    .where(eq(PostsTable.id, id));
  return await findPostById(db, id);
}

export async function clearPublicSnapshot(db: DB, id: number) {
  await db
    .update(PostsTable)
    .set({
      publicSnapshotJson: null,
      publicSlug: null,
      status: "draft",
      updatedAt: sql`${PostsTable.updatedAt}`,
    })
    .where(eq(PostsTable.id, id));
  return await findPostById(db, id);
}

export async function publicSlugExists(
  db: DB,
  slug: string,
  options: { excludeId?: number } = {},
): Promise<boolean> {
  const conditions = [eq(PostsTable.publicSlug, slug)];
  if (options.excludeId) {
    conditions.push(ne(PostsTable.id, options.excludeId));
  }
  const results = await db
    .select({ id: PostsTable.id })
    .from(PostsTable)
    .where(and(...conditions))
    .limit(1);
  return results.length > 0;
}

export async function deletePost(db: DB, id: number) {
  await db.delete(PostsTable).where(eq(PostsTable.id, id));
}

export async function slugExists(
  db: DB,
  slug: string,
  options: { excludeId?: number } = {},
): Promise<boolean> {
  const { excludeId } = options;
  const conditions = [eq(PostsTable.slug, slug)];
  if (excludeId) {
    conditions.push(ne(PostsTable.id, excludeId));
  }
  const results = await db
    .select({ id: PostsTable.id })
    .from(PostsTable)
    .where(and(...conditions))
    .limit(1);
  return results.length > 0;
}

export async function findSimilarSlugs(
  db: DB,
  baseSlug: string,
  options: { excludeId?: number } = {},
) {
  const conditions = [like(PostsTable.slug, `${baseSlug}-%`)];

  if (options.excludeId) {
    conditions.push(ne(PostsTable.id, options.excludeId));
  }

  const results = await db
    .select({ slug: PostsTable.slug })
    .from(PostsTable)
    .where(and(...conditions));

  return results.map((r) => r.slug);
}

export async function findAdjacentPublicPosts(db: DB, slug: string) {
  const currentPost = await db.query.PostsTable.findFirst({
    where: and(
      eq(PostsTable.publicSlug, slug),
      isNotNull(PostsTable.publicSnapshotJson),
    ),
    columns: { id: true, publicSnapshotJson: true },
  });

  const publishedAt = currentPost?.publicSnapshotJson?.publishedAt;
  if (!currentPost || !publishedAt) {
    return { newer: null, older: null };
  }

  const snapshotTitle = sql<string>`json_extract(${PostsTable.publicSnapshotJson}, '$.title')`;

  const [newer] = await db
    .select({
      slug: PostsTable.publicSlug,
      title: snapshotTitle,
    })
    .from(PostsTable)
    .where(
      and(
        isNotNull(PostsTable.publicSnapshotJson),
        isNotNull(PostsTable.publicSlug),
        or(
          gt(snapshotPublishedAt, publishedAt),
          and(
            eq(snapshotPublishedAt, publishedAt),
            gt(PostsTable.id, currentPost.id),
          ),
        ),
      ),
    )
    .orderBy(asc(snapshotPublishedAt), asc(PostsTable.id))
    .limit(1);

  const [older] = await db
    .select({
      slug: PostsTable.publicSlug,
      title: snapshotTitle,
    })
    .from(PostsTable)
    .where(
      and(
        isNotNull(PostsTable.publicSnapshotJson),
        isNotNull(PostsTable.publicSlug),
        or(
          lt(snapshotPublishedAt, publishedAt),
          and(
            eq(snapshotPublishedAt, publishedAt),
            lt(PostsTable.id, currentPost.id),
          ),
        ),
      ),
    )
    .orderBy(desc(snapshotPublishedAt), desc(PostsTable.id))
    .limit(1);

  return {
    newer: newer?.slug ? { slug: newer.slug, title: newer.title } : null,
    older: older?.slug ? { slug: older.slug, title: older.title } : null,
  };
}
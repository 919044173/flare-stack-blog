import { Link } from "@tanstack/react-router";
import type { PostItem } from "@/features/posts/schema/posts.schema";
import { formatPublicPostDate } from "@/features/posts/utils/format-public-post-date";

interface ArchivePostProps {
  post: PostItem;
  isMoment?: boolean;
}

export function ArchivePost({ post, isMoment = false }: ArchivePostProps) {
  const date = post.publishedAt ? new Date(post.publishedAt) : null;
  const coverUrl = post.cover?.url;

  // ✅ 动态模式：卡片式布局
  if (isMoment) {
    return (
      <Link
        to="/post/$slug"
        params={{ slug: post.slug }}
        className="group block! w-full rounded-xl overflow-hidden hover:bg-(--fuwari-btn-plain-bg-hover) active:bg-(--fuwari-btn-plain-bg-active) transition-colors p-3"
        aria-label={post.title}
      >
        <div className="flex gap-3 items-stretch">
          {/* 左侧：封面大图 */}
          {coverUrl && (
            <div className="shrink-0 w-24 h-24 md:w-28 md:h-28 rounded-lg overflow-hidden bg-black/5 dark:bg-white/5">
              <img
                src={coverUrl}
                alt={post.title}
                loading="lazy"
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            </div>
          )}

          {/* 右侧：标题 + 摘要 + 日期 */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <h3 className="text-base md:text-lg font-bold group-hover:text-(--fuwari-primary) transition-colors line-clamp-1">
              {post.title}
            </h3>

            {/* 摘要：最多两行 */}
            {post.summary && (
              <p className="text-sm fuwari-text-50 mt-1 line-clamp-2 leading-snug">
                {post.summary}
              </p>
            )}

            {/* 日期 */}
            <time
              dateTime={date?.toISOString()}
              className="text-xs fuwari-text-30 mt-1.5"
            >
              {formatPublicPostDate(date, { monthDay: true })}
            </time>
          </div>
        </div>
      </Link>
    );
  }

  // ✅ 文章模式：保持原样（时间轴一行）
  return (
    <Link
      to="/post/$slug"
      params={{ slug: post.slug }}
      className="group block! h-10 w-full rounded-lg hover:bg-(--fuwari-btn-plain-bg-hover) active:bg-(--fuwari-btn-plain-bg-active) transition-colors"
      aria-label={post.title}
    >
      <div className="flex flex-row justify-start items-center h-full">
        {/* Date */}
        <div className="w-[15%] md:w-[10%] transition text-sm text-right fuwari-text-50">
          <time dateTime={date?.toISOString()}>
            {formatPublicPostDate(date, { monthDay: true })}
          </time>
        </div>

        {/* Dot and Line */}
        <div className="w-[15%] md:w-[10%] relative fuwari-timeline-dash h-full flex items-center">
          <div
            className="transition-all mx-auto w-1 h-1 rounded group-hover:h-5
              bg-black/50 dark:bg-white/50 group-hover:bg-(--fuwari-primary)
              outline z-50
              outline-(--fuwari-card-bg)
              group-hover:outline-(--fuwari-btn-plain-bg-hover)
              group-active:outline-(--fuwari-btn-plain-bg-active)"
          />
        </div>

        {/* Post Title */}
        <div className="text-left font-bold group-hover:translate-x-1 transition-all group-hover:text-(--fuwari-primary) fuwari-text-75 pr-8 whitespace-nowrap overflow-ellipsis overflow-hidden w-[70%] md:max-w-[65%] md:w-[65%]">
          {post.title}
        </div>

        {/* Tag List */}
        <div className="hidden md:block md:w-[15%] text-left text-sm transition whitespace-nowrap overflow-ellipsis overflow-hidden fuwari-text-30">
          {post.tags?.map((t) => `#${t.name}`).join(" ")}
        </div>
      </div>
    </Link>
  );
}
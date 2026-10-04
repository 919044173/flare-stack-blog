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

  // ✅ 动态模式：朋友圈风
  if (isMoment) {
    return (
      <Link
        to="/post/$slug"
        params={{ slug: post.slug }}
        className="group block! w-full rounded-xl overflow-hidden bg-(--fuwari-card-bg) border border-black/5 dark:border-white/5 hover:shadow-lg transition-all duration-300"
        aria-label={post.summary || post.title || "动态"}
      >
        {/* 有封面时：显示大图 */}
        {coverUrl && (
          <div className="w-full aspect-video overflow-hidden bg-black/5 dark:bg-white/5">
            <img
              src={coverUrl}
              alt={post.title || "动态"}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          </div>
        )}

        <div className="p-4">
          {/* 有封面：小字号 + 限制 5 行；无封面：大字号 + 全文显示 */}
          <p
            className={`fuwari-text-75 leading-relaxed wrap-break-word ${
              coverUrl
                ? "text-sm md:text-base line-clamp-5"
                : "text-base md:text-lg"
            }`}
          >
            {post.summary || post.title}
          </p>

          <div className="flex items-center justify-between mt-3">
            <time
              dateTime={date?.toISOString()}
              className="text-xs fuwari-text-30"
            >
              {formatPublicPostDate(date, { monthDay: true })}
            </time>

            {post.tags && post.tags.length > 0 && (
              <div className="text-xs fuwari-text-30 truncate ml-2">
                {post.tags.map((t) => `#${t.name}`).join(" ")}
              </div>
            )}
          </div>
        </div>
      </Link>
    );
  }

  // ✅ 文章模式：保留时间轴布局（保持原样）
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
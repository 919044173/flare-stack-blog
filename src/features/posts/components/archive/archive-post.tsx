import { Link } from "@tanstack/react-router";
import type { PostItem } from "@/features/posts/schema/posts.schema";
import { formatPublicPostDate } from "@/features/posts/utils/format-public-post-date";
import {
  getPublicImageSrc,
  PUBLIC_IMAGE_WIDTH,
} from "@/features/media/utils/media.utils";

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
  className="group block! w-full rounded-xl overflow-hidden bg-(--fuwari-card-bg) border border-black/10 dark:border-white/10 shadow-sm hover:shadow-lg transition-all duration-300"
  aria-label={post.summary || post.title || "动态"}
>
        {coverUrl && (
  <div className="w-full aspect-video overflow-hidden bg-black/5 dark:bg-white/5">
    <img
      src={getPublicImageSrc(coverUrl, PUBLIC_IMAGE_WIDTH.cover)}
      alt={post.title || "动态"}
      loading="lazy"
      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
    />
  </div>
)}

        <div className="p-4">
          <p
            className={`fuwari-text-75 leading-relaxed wrap-break-word indent-[2em] ${
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

  // ✅ 文章模式：保留时间轴 + 加封面缩略图 + 摘要
  return (
    <div className="group flex flex-row w-full">
      {/* 左侧：日期 */}
      <div className="w-[15%] md:w-[10%] transition text-sm text-right fuwari-text-50 pt-3">
        <time dateTime={date?.toISOString()}>
          {formatPublicPostDate(date, { monthDay: true })}
        </time>
      </div>

      {/* 中间：时间轴圆点 + 竖线 */}
      <div className="w-[15%] md:w-[10%] relative fuwari-timeline-dash flex flex-col items-center">
        <div
          className="transition-all w-1 h-1 rounded mt-4
            bg-black/50 dark:bg-white/50
            outline z-50
            outline-(--fuwari-card-bg)"
        />
      </div>

      {/* 右侧：封面 + 标题 + 摘要 */}
      <div className="w-[70%] md:w-[80%] pl-2 pb-3">
        <Link
          to="/post/$slug"
          params={{ slug: post.slug }}
          className="block! w-full rounded-xl overflow-hidden bg-(--fuwari-card-bg) border border-black/5 dark:border-white/5 hover:shadow-md hover:bg-(--fuwari-btn-plain-bg-hover) transition-all duration-300"
          aria-label={post.title}
        >
          <div className="flex gap-3 p-3">
            {/* 封面缩略图 */}
            {coverUrl && (
              <div className="shrink-0 w-20 h-20 md:w-24 md:h-24 rounded-lg overflow-hidden bg-black/5 dark:bg-white/5">
                <img
                  src={getPublicImageSrc(coverUrl, PUBLIC_IMAGE_WIDTH.cover)}
                  alt={post.title}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>
            )}

            {/* 标题 + 摘要 */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <h3 className="text-sm md:text-base font-bold group-hover:text-(--fuwari-primary) transition-colors line-clamp-1">
                {post.title}
              </h3>

              {post.summary && (
                <p className="text-xs md:text-sm fuwari-text-50 mt-1 line-clamp-2 leading-snug indent-[2em]">
                  {post.summary}
                </p>
              )}

              {post.tags && post.tags.length > 0 && (
                <div className="text-xs fuwari-text-30 truncate mt-1.5">
                  {post.tags.map((t) => `#${t.name}`).join(" ")}
                </div>
              )}
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
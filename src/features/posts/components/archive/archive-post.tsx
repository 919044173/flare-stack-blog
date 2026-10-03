import { Link } from "@tanstack/react-router";
import type { PostItem } from "@/features/posts/schema/posts.schema";
import { formatPublicPostDate } from "@/features/posts/utils/format-public-post-date";

interface ArchivePostProps {
  post: PostItem;
  isMoment?: boolean; // ✅ 动态模式标识
}

export function ArchivePost({ post, isMoment = false }: ArchivePostProps) {
  const date = post.publishedAt ? new Date(post.publishedAt) : null;

  // ⚠️ 把 post.cover 换成你实际的封面字段名
  //    常见命名：cover / coverUrl / image / thumbnail
  const cover = post.cover;

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

        {/* Dot and Line：动态模式下不显示时间轴的圆点 */}
        {!isMoment && (
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
        )}

        {/* ✅ 新增：仅动态模式显示封面缩略图 */}
        {isMoment && cover && (
          <div className="shrink-0 w-7 h-7 md:w-8 md:h-8 ml-1 md:ml-2 overflow-hidden rounded-md bg-black/5 dark:bg-white/5">
            <img
              src={cover}
              alt={post.title}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
            />
          </div>
        )}

        {/* Post Title：完全保持你原来的写法，文章页不受任何影响 */}
        <div
          className={`text-left font-bold group-hover:translate-x-1 transition-all group-hover:text-(--fuwari-primary) fuwari-text-75 pr-8 whitespace-nowrap overflow-ellipsis overflow-hidden ${
            isMoment
              ? "w-[85%] md:w-[80%] text-base"
              : "w-[70%] md:max-w-[65%] md:w-[65%]"
          }`}
        >
          {post.title}
        </div>

        {/* Tag List：动态模式下不显示标签 */}
        {!isMoment && (
          <div className="hidden md:block md:w-[15%] text-left text-sm transition whitespace-nowrap overflow-ellipsis overflow-hidden fuwari-text-30">
            {post.tags?.map((t) => `#${t.name}`).join(" ")}
          </div>
        )}
      </div>
    </Link>
  );
}
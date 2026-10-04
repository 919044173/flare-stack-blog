import type { PostItem } from "@/features/posts/schema/posts.schema";
import { ArchivePost } from "./archive-post";
import { ArchiveYear } from "./archive-year";

interface ArchivePanelProps {
  posts: Array<PostItem>;
  isMoment?: boolean;
}

export function ArchivePanel({ posts, isMoment = false }: ArchivePanelProps) {
  const groupedPosts = posts.reduce(
    (acc, post) => {
      if (!post.publishedAt) {
        return acc;
      }

      const year = new Date(post.publishedAt).getUTCFullYear();
      acc[year] ??= [];
      acc[year].push(post);
      return acc;
    },
    {} as Record<number, Array<PostItem>>,
  );

  const years = Object.keys(groupedPosts)
    .map(Number)
    .sort((a, b) => b - a);

  return (
    <div className="fuwari-card-base px-8 py-6">
      {years.map((year) => (
        <div key={year}>
          <ArchiveYear
            year={year}
            count={groupedPosts[year].length}
            isMoment={isMoment}
          />

          {isMoment ? (
  <div className="flex flex-col mt-3">
    {groupedPosts[year].map((post, index) => (
      <div key={post.id}>
        {index > 0 && (
          <div className="flex items-center gap-6 my-6 text-xs fuwari-text-30">
            <span className="flex-1 border-t border-dashed border-black/25 dark:border-white/15" />
            <span className="px-2 select-none">≽^⚈⩊⚈^≼</span>
            <span className="flex-1 border-t border-dashed border-black/15 dark:border-white/15" />
          </div>
        )}
        <ArchivePost post={post} isMoment={isMoment} />
      </div>
    ))}
  </div>
) : (
            // 文章模式：保留时间轴（每条之间有小间距）
            <div className="flex flex-col gap-1 mt-1">
              {groupedPosts[year].map((post) => (
                <ArchivePost key={post.id} post={post} isMoment={isMoment} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
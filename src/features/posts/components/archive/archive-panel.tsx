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
            // 动态模式：竖向卡片列表
            <div className="flex flex-col gap-4 mt-3">
              {groupedPosts[year].map((post) => (
                <ArchivePost key={post.id} post={post} isMoment={isMoment} />
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
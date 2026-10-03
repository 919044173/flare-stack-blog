import type { PostItem } from "@/features/posts/schema/posts.schema";
import { ArchivePost } from "./archive-post";
import { ArchiveYear } from "./archive-year";

interface ArchivePanelProps {
  posts: Array<PostItem>;
  isMoment?: boolean; // ✅ 新增
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
          <ArchiveYear year={year} count={groupedPosts[year].length} />
          {groupedPosts[year].map((post) => (
            <ArchivePost key={post.id} post={post} isMoment={isMoment} /> // ✅ 传下去
          ))}
        </div>
      ))}
    </div>
  );
}
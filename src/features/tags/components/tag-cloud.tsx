import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ExpandableSidebarCard } from "@/components/layout/expandable-sidebar-card";
import { Skeleton } from "@/components/ui/skeleton";
import { withTagFilter } from "@/features/posts/utils/post-public-search";
import { tagsQueryOptions } from "@/features/tags/queries";
import { m } from "@/paraglide/messages";

const COLLAPSE_THRESHOLD = 20;

export function TagsSkeleton() {
  return (
    <div className="fuwari-card-base p-4">
      <Skeleton className="h-5 w-20 mb-3" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-16 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function Tags() {
  const { data: tags } = useSuspenseQuery(tagsQueryOptions);
  const [expanded, setExpanded] = useState(false);

  // ✅ 过滤掉"动态"标签（动态不参与标签筛选）
  const visibleTags = tags.filter((tag) => tag.name !== "动态");

  if (visibleTags.length === 0) return null;

  const collapsed = visibleTags.length >= COLLAPSE_THRESHOLD && !expanded;

  return (
    <ExpandableSidebarCard
      title={m.tags_title()}
      collapsed={collapsed}
      onExpand={() => setExpanded(true)}
      contentClassName="flex flex-wrap gap-2"
    >
      {visibleTags.map((tag) => (
        <Link
          key={tag.id}
          to="/posts"
          search={withTagFilter(tag.name)}
          className="fuwari-btn-regular h-8 text-sm px-3 rounded-lg"
        >
          {tag.name}
        </Link>
      ))}
    </ExpandableSidebarCard>
  );
}
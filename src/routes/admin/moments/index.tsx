import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { categoriesQueryOptions } from "@/features/categories/queries";
import { PostManager } from "@/features/posts/components/post-manager";
import { PostManagerPageSkeleton } from "@/features/posts/components/post-manager/post-manager-skeleton";
import type {
  SortField,
  StatusFilter,
} from "@/features/posts/components/post-manager/types";
import {
  SORT_FIELDS,
  STATUS_FILTERS,
} from "@/features/posts/components/post-manager/types";

const searchSchema = z.object({
  page: z.number().int().positive().optional().default(1).catch(1),
  status: z.enum(STATUS_FILTERS).optional().default("ALL").catch("ALL"),
  sortBy: z
    .enum(SORT_FIELDS)
    .optional()
    .default("updatedAt")
    .catch("updatedAt"),
  search: z.string().optional().default("").catch(""),
});

type MomentsSearchParams = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/admin/moments/")({
  ssr: false,
  validateSearch: searchSchema,
  pendingComponent: PostManagerPageSkeleton,
  pendingMs: 0,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(categoriesQueryOptions);
    return { title: "动态管理" };
  },
  component: MomentManagerPage,
});

function MomentManagerPage() {
  const navigate = useNavigate();
  const { page, status, sortBy, search } = Route.useSearch();

  const { data: categories } = useQuery(categoriesQueryOptions);
  const momentCategory = categories?.find((c) => c.name === "动态");

  const updateSearch = (updates: Partial<MomentsSearchParams>) => {
    navigate({
      to: "/admin/moments",
      search: {
        page: updates.page ?? 1,
        status: updates.status ?? status,
        sortBy: updates.sortBy ?? sortBy,
        search: updates.search ?? search,
      },
    });
  };

  const handleResetFilters = () => {
    navigate({
      to: "/admin/moments",
      search: {
        page: 1,
        status: "ALL",
        sortBy: "updatedAt",
        search: "",
      },
    });
  };

  return (
    <PostManager
      page={page}
      status={status}
      sortBy={sortBy}
      search={search}
      taxonomy={
        momentCategory
          ? {
              kind: "category",
              id: momentCategory.id,
              scope: "public",
            }
          : undefined
      }
      defaultCategoryName="动态"
      defaultCreateLabel="新建动态"
      onPageChange={(newPage) => updateSearch({ page: newPage })}
      onStatusChange={(newStatus: StatusFilter) =>
        updateSearch({ status: newStatus })
      }
      onSortByChange={(nextSortBy: SortField) =>
        updateSearch({ sortBy: nextSortBy })
      }
      onSearchChange={(newSearch) => updateSearch({ search: newSearch })}
      onResetFilters={handleResetFilters}
    />
  );
}
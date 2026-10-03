import {
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { siteConfigQuery, siteDomainQuery } from "@/features/config/queries";
import { POSTS_PER_PAGE } from "@/features/posts/components/posts-page";
import { categoriesQueryOptions } from "@/features/categories/queries";
import { postsInfiniteQueryOptions } from "@/features/posts/queries";
import {
  PostCategoryNameSchema,
  PostTagNameSchema,
} from "@/features/posts/schema/posts.schema";
import { withTagFilter } from "@/features/posts/utils/post-public-search";
import { tagsQueryOptions } from "@/features/tags/queries";
import { buildCanonicalUrl, canonicalLink } from "@/lib/seo";
import { m } from "@/paraglide/messages";

const MOMENTS_CATEGORY_NAME = "动态"; 

export const Route = createFileRoute("/_public/moments")({
  validateSearch: z.object({
    tagName: PostTagNameSchema,
  }),
  component: RouteComponent,
  pendingComponent: PostsSkeleton,
  loaderDeps: ({ search }) => ({
    tagName: search.tagName,
  }),
  loader: async ({ context, deps }) => {
    const [, , , domain, siteConfig] = await Promise.all([
      context.queryClient.prefetchInfiniteQuery(
        postsInfiniteQueryOptions({
          categoryName: MOMENTS_CATEGORY_NAME,
          tagName: deps.tagName,
          limit: POSTS_PER_PAGE,
        }),
      ),
      context.queryClient.prefetchQuery(tagsQueryOptions),
      context.queryClient.prefetchQuery(categoriesQueryOptions),
      context.queryClient.ensureQueryData(siteDomainQuery),
      context.queryClient.ensureQueryData(siteConfigQuery),
    ]);

    return {
      title: "日常动态",
      description: siteConfig.description,
      canonicalHref: buildCanonicalUrl(domain, "/moments", {
        tagName: deps.tagName,
      }),
    };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.title,
      },
      {
        name: "description",
        content: loaderData?.description,
      },
    ],
    links: [canonicalLink(loaderData?.canonicalHref ?? "/moments")],
  }),
});

// 骨架屏
function PostsSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 animate-pulse">
      <div className="flex items-center gap-4 mb-10 pb-6 border-b border-gray-100">
        <div className="w-16 h-16 rounded-full bg-gray-200" />
        <div>
          <div className="h-6 w-24 bg-gray-200 rounded mb-2" />
          <div className="h-4 w-32 bg-gray-100 rounded" />
        </div>
      </div>
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4">
            <div className="w-4 h-4 rounded-full bg-gray-200 mt-2" />
            <div className="flex-1 bg-gray-100 rounded-2xl h-32" />
          </div>
        ))}
      </div>
    </div>
  );
}

// 核心组件
function RouteComponent() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  
  const { data: tags } = useSuspenseQuery(tagsQueryOptions);
  // 获取站点配置
  const { data: siteConfig } = useSuspenseQuery(siteConfigQuery);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useSuspenseInfiniteQuery(
      postsInfiniteQueryOptions({
        categoryName: MOMENTS_CATEGORY_NAME,
        tagName: search.tagName,
        limit: POSTS_PER_PAGE,
      }),
    );

  const posts = useMemo(() => {
    return data.pages.flatMap((page) => page.items);
  }, [data]);

  const handleTagClick = (clickedTag?: string) => {
    navigate({
      search: withTagFilter(clickedTag),
      replace: true,
    });
  };

  // 空状态
  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-gray-400">
        <div className="text-6xl mb-4 font-mono">(´･_･`)</div>
        <p className="text-sm">还没有发布任何动态哦~</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* 
        头部博主信息区 
        ⚠️ 改用与背景重叠的样式，视觉更舒服
      */}
      <div className="relative mb-12">
        {/* 头像：绝对定位，制造重叠效果 */}
        <div className="absolute -top-16 left-0">
          {siteConfig.authorAvatar ? (
            <img
              src={siteConfig.authorAvatar} 
              alt={siteConfig.authorName || "Author"}
              className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-md bg-white z-10"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-blue-100 border-4 border-white flex items-center justify-center text-blue-500 text-3xl shadow-md z-10">
              {siteConfig.authorName?.charAt(0)?.toUpperCase() || "A"}
            </div>
          )}
        </div>
        
        {/* 文字区域：留出头像的空间 */}
        <div className="ml-28 pt-2">
          <h1 className="text-2xl font-bold text-gray-800">
            {siteConfig.authorName || "ay."}
          </h1>
          <p className="text-sm text-gray-500 mt-1 line-clamp-2">
            {siteConfig.description || "记录生活，分享瞬间"}
          </p>
        </div>
      </div>

      {/* 时间轴容器 */}
      <div className="relative border-l-2 border-gray-100 ml-6 space-y-8 pb-8">
        {posts.map((post) => (
          <div key={post.id} className="relative pl-8">
            {/* 时间轴圆点 */}
            <div className="absolute -left-[9px] top-1.5 w-4 h-4 rounded-full bg-white border-2 border-blue-400 shadow-sm z-10" />

            {/* 日期 */}
            <div className="text-xs text-gray-400 mb-2 font-mono">
              {new Date(post.createdAt).toLocaleDateString("zh-CN", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              })}
            </div>

            {/* 动态内容卡片 */}
            <Link 
              to={`/posts/${post.slug}`} 
              className="block group"
            >
              <div className="bg-white rounded-2xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.03)] border border-gray-50 group-hover:shadow-lg group-hover:border-blue-100 transition-all duration-300">
                
                {/* ⚠️ 修复：增加了图片加载错误处理，只有图片能加载时才显示 */}
                {post.cover && (
                  <div className="mb-4 overflow-hidden rounded-xl bg-gray-50">
                    <img 
                      src={post.cover} 
                      alt={post.title || "动态图片"} 
                      onError={(e) => {
                        // 如果图片加载失败，隐藏外层包裹的 div
                        (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                      }}
                      className="w-full h-auto max-h-[300px] object-cover group-hover:scale-[1.02] transition-transform duration-500"
                    />
                  </div>
                )}

                {/* 内容区域 */}
                <div
                  className="prose prose-sm max-w-none text-gray-700 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: post.content }}
                />

                {/* 底部操作栏 */}
                <div className="mt-4 pt-3 border-t border-gray-50 flex items-center justify-between text-xs text-gray-400">
                  <span>
                    发布于 {new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-blue-400 group-hover:text-blue-500 transition-colors">
                    查看详情 →
                  </span>
                </div>
              </div>
            </Link>
          </div>
        ))}
      </div>

      {/* 加载更多区域 */}
      <div className="flex justify-center mt-10 mb-8">
        {hasNextPage ? (
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="px-6 py-2.5 bg-white border border-gray-200 rounded-full text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-50 shadow-sm"
          >
            {isFetchingNextPage ? "加载中..." : "加载更多动态"}
          </button>
        ) : (
          <div className="flex items-center gap-4 text-gray-400 text-sm">
            <span className="w-12 h-px bg-gray-200"></span>
            已经到底啦
            <span className="w-12 h-px bg-gray-200"></span>
          </div>
        )}
      </div>
    </div>
  );
}
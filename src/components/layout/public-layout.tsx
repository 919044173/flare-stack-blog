import {
  useLocation,
  useRouteContext,
  useRouterState,
} from "@tanstack/react-router";
import type { PublicLayoutProps } from "@/components/layout/layout-props";
import {
  getPublicImageSrc,
  PUBLIC_IMAGE_WIDTH,
} from "@/features/media/utils/media.utils";
import { cn } from "@/lib/utils";
import { BackToTop } from "./back-to-top";
import { Footer } from "./footer";
import { Navbar } from "./navbar";
import { PageFade } from "./page-fade";
import { Sidebar } from "./sidebar";

const BANNER_HEIGHT_HOME = 65;
const BANNER_HEIGHT_PAGE = 35;
const MAIN_OVERLAP_REM = 3.5;
const NAVBAR_HEIGHT_REM = 4.5;

export function PublicLayout({
  children,
  navOptions,
  user,
  isSessionLoading,
  logout,
}: PublicLayoutProps) {
  const { siteConfig } = useRouteContext({ from: "__root__" });
  const location = useLocation();
  const isHomePage = location.pathname === "/";
  const isAuthPage = useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId.includes("/_auth")),
  });
  const hasRouteError = useRouterState({
    select: (state) =>
      state.matches.some(
        (match) => match.status === "error" || match.status === "notFound",
      ),
  });
  const isFocusedPage =
    hasRouteError ||
    isAuthPage ||
    location.pathname === "/submit-friend-link" ||
    location.pathname === "/profile";
  const bannerHeightVh = isHomePage ? BANNER_HEIGHT_HOME : BANNER_HEIGHT_PAGE;

  return (
    <div className="relative min-h-screen bg-(--fuwari-page-bg) transition-colors">
      {/* Top row: Navbar - sticky */}
      <div className="sticky top-0 z-50 pointer-events-none">
        <div className="pointer-events-auto max-w-(--fuwari-page-width) mx-auto px-0 md:px-4">
          <Navbar
            navOptions={navOptions}
            logout={logout}
            user={user}
            isLoading={isSessionLoading}
            bannerHeightVh={bannerHeightVh}
          />
        </div>
      </div>

      {/* Banner - full width background */}
      <div
        className="absolute left-0 right-0 top-0 z-10 overflow-hidden transition-[height] duration-700"
        style={{ height: `${bannerHeightVh}vh` }}
      >
        <img
          src={getPublicImageSrc(
            siteConfig.theme.fuwari.homeBg,
            PUBLIC_IMAGE_WIDTH.banner,
          )}
          alt="banner"
          fetchPriority={isHomePage ? "high" : "auto"}
          className="fuwari-banner-image w-full h-full object-cover object-center"
        />
      </div>

      {/* Main content - overlaps banner by MAIN_OVERLAP_REM */}
      <div
        className="relative z-30 transition-[margin-top] duration-700"
        style={{
          marginTop: `calc(${bannerHeightVh}vh - ${MAIN_OVERLAP_REM}rem - ${NAVBAR_HEIGHT_REM}rem)`,
        }}
      >
        {/* ✅ 终极方案：完全放弃 public-content-grid 类名，用纯 Flex + !important */}
        <div
          className={cn(
            "relative mx-auto px-0 md:px-4 pb-8",
            isFocusedPage
              ? "!flex !flex-col"
              : "!flex !flex-col lg:!flex-row gap-4",
          )}
          style={{ maxWidth: "var(--fuwari-page-width)" }}
        >
          {/* 侧边栏（左侧栏，手机端在底部） */}
          {isFocusedPage ? null : (
            <div className="order-2 lg:order-1 w-full lg:w-[17.5rem] shrink-0">
              <Sidebar />
            </div>
          )}

          {/* 文章列表（右侧主区域） */}
          <main
            className={cn(
              "flex flex-col gap-4 min-w-0 flex-1",
              isFocusedPage ? "" : "order-1 lg:order-2",
            )}
          >
            <PageFade includeSearch={location.pathname !== "/search"}>
              {children}
            </PageFade>
          </main>

          {/* 页脚（右侧主区域下方） */}
          <div
            className={cn(
              "public-footer fuwari-onload-animation mt-auto",
              isFocusedPage ? "" : "order-3 w-full",
            )}
            style={{ animationDelay: "250ms" }}
          >
            <Footer navOptions={navOptions} />
          </div>

          <BackToTop />
        </div>
      </div>
    </div>
  );
}
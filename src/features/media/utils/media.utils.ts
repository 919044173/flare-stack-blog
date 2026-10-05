// ==========================================
// 1. 全局配置：你的 R2 自定义域名
// ⚠️ 请务必确认这里是你在 Cloudflare R2 绑定的实际域名
// ==========================================
const R2_PUBLIC_DOMAIN = "https://img.ryn.us.ci"; 

export function getContentTypeFromKey(key: string): string | undefined {
  const extension = key.split(".").pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    avif: "image/avif",
  };
  return contentTypes[extension || ""];
}

export function generateKey(fileName: string): string {
  const uuid = crypto.randomUUID();
  const extension = fileName.split(".").pop()?.toLowerCase() || "bin";

  return `${uuid}.${extension}`;
}

/**
 * 从图片 URL 中提取 R2 key
 * 支持格式：
 * - /images/${key}
 * - /images/${key}?quality=80&format=webp
 * - https://domain.com/images/${key}?quality=80
 */
export function extractImageKey(src: string): string | undefined {
  if (!src) return undefined;

  const prefix = "/images/";
  let pathname = "";

  try {
    // 尝试解析为 URL
    const url = new URL(src, "http://dummy.com"); // 传入 base 确保相对路径也能被解析
    pathname = url.pathname;
  } catch {
    // 极少数情况解析失败，手动截断 query
    pathname = src.split("?")[0];
  }

  if (pathname.startsWith(prefix)) {
    return pathname.replace(prefix, "");
  }
  return undefined;
}

/**
 * 生成优化后的图片 URL
 * @param key - R2 key
 * @param width - 可选的宽度限制
 */
export function isGifKey(key: string, contentType?: string | null) {
  return key.toLowerCase().endsWith(".gif") || contentType === "image/gif";
}

export const PUBLIC_IMAGE_WIDTH = {
  banner: 1600,
  cover: 800,
  body: 800,
  avatar: 400,
} as const;

/**
 * 获取原图 URL（用于正文大图，无参数，纯 CDN 静态缓存）
 */
export function getOriginalImageUrl(key: string) {
  // ✅ 修改：加上 R2 自定义域名前缀
  return `${R2_PUBLIC_DOMAIN}/images/${key}`;
}

export function hasImageTransformParams(searchParams: URLSearchParams) {
  return (
    searchParams.has("width") ||
    searchParams.has("height") ||
    searchParams.has("quality") ||
    searchParams.has("fit")
  );
}

/**
 * 获取压缩后的图片 URL（用于缩略图、头像，触发 Cloudflare 图像转换）
 */
export function getOptimizedImageUrl(key: string, width?: number) {
  if (isGifKey(key)) {
    // ✅ 修改：加上域名前缀
    return `${R2_PUBLIC_DOMAIN}/images/${key}?original=true`;
  }
  // ✅ 修改：加上域名前缀
  return `${R2_PUBLIC_DOMAIN}/images/${key}?quality=80${width ? `&width=${width}` : ""}`;
}

/**
 * 统一入口：根据 src 提取 key，重新生成带域名的完整 URL
 */
export function getPublicImageSrc(src: string, width: number) {
  const key = extractImageKey(src);
  if (!key) return src;
  const version = new URL(src, "http://dummy.com").searchParams.get("v");
  const optimized = getOptimizedImageUrl(key, width);
  if (!version) return optimized;
  const next = new URL(optimized, "http://dummy.com");
  next.searchParams.set("v", version);
  // ✅ 修改：这里必须重新拼上 R2_PUBLIC_DOMAIN，否则域名会丢失
  return `${R2_PUBLIC_DOMAIN}${next.pathname}${next.search}`;
}

export function buildTransformOptions(
  searchParams: URLSearchParams,
  accept: string,
) {
  const transformOptions: Record<string, unknown> = { quality: 80 };

  if (searchParams.has("width")) {
    const width = Number.parseInt(searchParams.get("width")!, 10);
    if (!Number.isNaN(width) && width > 0) transformOptions.width = width;
  }
  if (searchParams.has("height")) {
    const height = Number.parseInt(searchParams.get("height")!, 10);
    if (!Number.isNaN(height) && height > 0) transformOptions.height = height;
  }
  if (searchParams.has("quality")) {
    const quality = Number.parseInt(searchParams.get("quality")!, 10);
    if (!Number.isNaN(quality) && quality > 0 && quality <= 100)
      transformOptions.quality = quality;
  }
  if (searchParams.has("fit")) transformOptions.fit = searchParams.get("fit");

  if (/image\/avif/.test(accept)) {
    transformOptions.format = "avif";
  } else if (/image\/webp/.test(accept)) {
    transformOptions.format = "webp";
  }

  return transformOptions;
}

// ==========================================
// 以下为 SEO 和 JSON-LD 的构建函数，保持原样即可
// ==========================================

type ArticleJsonLdInput = {
  authorName: string;
  canonicalHref: string;
  post: {
    slug: string;
    summary?: string | null;
    title: string;
    publishedAt?: Date | string | null;
    updatedAt: Date | string;
    tags?: Array<{ name: string }> | undefined;
    image?: string | null;
  };
};

function buildCanonicalHref(
  pathname: string,
  searchParams?: Record<string, string | undefined>,
) {
  const normalizedPath =
    pathname === "/" ? "/" : pathname.replace(/\/+$/, "") || "/";

  if (!searchParams) return normalizedPath;

  const params = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });

  const query = params.toString();
  return query ? `${normalizedPath}?${query}` : normalizedPath;
}

export function buildCanonicalUrl(
  domain: string,
  pathname: string,
  searchParams?: Record<string, string | undefined>,
) {
  return `https://${domain}${buildCanonicalHref(pathname, searchParams)}`;
}

export function canonicalLink(href: string) {
  return {
    rel: "canonical",
    href,
  } as const;
}

export function buildArticleJsonLd({
  authorName,
  canonicalHref,
  post,
}: ArticleJsonLdInput) {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    url: canonicalHref,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalHref,
    },
    author: {
      "@type": "Person",
      name: authorName,
    },
    dateModified: new Date(post.updatedAt).toISOString(),
  };

  if (post.summary) {
    jsonLd.description = post.summary;
  }

  if (post.publishedAt) {
    jsonLd.datePublished = new Date(post.publishedAt).toISOString();
  }

  const keywords = post.tags?.map((tag) => tag.name).filter(Boolean);
  if (keywords?.length) {
    jsonLd.keywords = keywords;
  }

  if (post.image) {
    jsonLd.image = post.image;
  }

  return JSON.stringify(jsonLd);
}
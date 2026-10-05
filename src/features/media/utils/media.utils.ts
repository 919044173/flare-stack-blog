// ==========================================
// 全局配置：你的 R2 自定义域名
// ==========================================
export const R2_PUBLIC_DOMAIN = "https://img.ryn.us.ci"; 

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
 * 从完整 URL 中提取 R2 存储桶里的纯文件名（key）
 * 例子：
 *   输入：https://img.ryn.us.ci/images/478c7895.png?width=800
 *   输出：478c7895.png
 */
export function extractImageKey(src: string): string | undefined {
  if (!src) return undefined;
  
  // 如果直接是纯文件名（没有 http），直接返回
  if (!src.startsWith("http")) {
    // 去掉可能存在的参数
    return src.split("?")[0].replace(/^\/?(images\/)?/, "");
  }

  // 如果是完整 URL，提取 pathname 里的文件名
  try {
    const url = new URL(src);
    // pathname 可能是 /images/478c7895.png
    const path = url.pathname;
    // 剥掉 /images/ 前缀，拿到纯文件名
    return path.replace(/^\/?(images\/)?/, "");
  } catch {
    return undefined;
  }
}

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
 * 获取原图 URL
 * ✅ 路径格式：https://img.ryn.us.ci/images/xxx.png
 */
export function getOriginalImageUrl(key: string) {
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
 * 获取压缩后的图片 URL
 * ✅ 路径格式：https://img.ryn.us.ci/images/xxx.png?quality=80&width=800
 */
export function getOptimizedImageUrl(key: string, width?: number) {
  if (isGifKey(key)) {
    return `${R2_PUBLIC_DOMAIN}/images/${key}?original=true`;
  }
  return `${R2_PUBLIC_DOMAIN}/images/${key}?quality=80${width ? `&width=${width}` : ""}`;
}

/**
 * 统一的图片入口函数
 * 逻辑：从任意传入的 src 提取文件名，然后用标准路径重新拼一遍。
 */

/**
 * 统一的图片入口函数
 * 逻辑：从任意传入的 src 提取文件名，然后用标准路径重新拼一遍。
 */
export function getPublicImageSrc(src: string, width: number) {
  // ✅ 新增逻辑：如果已经是 R2 上的 asset 资源，直接返回原 URL，不进行二次拼接
  if (src.includes("/asset/")) {
    return src;
  }

  const key = extractImageKey(src);
  if (!key) return src; // 如果提不出文件名，原样返回

  // 用提取出的文件名，拼接成最终带参数的标准 URL
  return getOptimizedImageUrl(key, width);
}

// 下面的 SEO 和 JSON-LD 构建函数保持原样，直接复制你之前的即可
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
  if (/image\/avif/.test(accept)) transformOptions.format = "avif";
  else if (/image\/webp/.test(accept)) transformOptions.format = "webp";
  return transformOptions;
}

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
    if (value) params.set(key, value);
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
  return { rel: "canonical", href } as const;
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
    mainEntityOfPage: { "@type": "WebPage", "@id": canonicalHref },
    author: { "@type": "Person", name: authorName },
    dateModified: new Date(post.updatedAt).toISOString(),
  };
  if (post.summary) jsonLd.description = post.summary;
  if (post.publishedAt) jsonLd.datePublished = new Date(post.publishedAt).toISOString();
  const keywords = post.tags?.map((tag) => tag.name).filter(Boolean);
  if (keywords?.length) jsonLd.keywords = keywords;
  if (post.image) jsonLd.image = post.image;
  return JSON.stringify(jsonLd);
}
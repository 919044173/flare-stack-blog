import { generateKey, R2_PUBLIC_DOMAIN } from "@/features/media/utils/media.utils";

export async function putToR2(
  env: Env,
  image: File,
  key = generateKey(image.name),
) {
  const contentType = image.type;
  
  // ✅ 数据库里存的完整绝对路径（带 images/）
  const url = `${R2_PUBLIC_DOMAIN}/images/${key}`;

  // ✅ 物理存储路径：加上 images/ 前缀，真正存进 images 文件夹
  await env.R2.put(`images/${key}`, image.stream(), {
    httpMetadata: {
      contentType,
    },
    customMetadata: {
      originalName: image.name,
    },
  });

  return {
    key,
    url,
    fileName: image.name,
    mimeType: contentType,
    sizeInBytes: image.size,
  };
}

export async function deleteFromR2(env: Env, key: string) {
  // 物理删除时也要带上 images/ 前缀
  await env.R2.delete(`images/${key}`);
}

export async function getFromR2(env: Env, key: string) {
  // 读取时也要带上 images/ 前缀
  return await env.R2.get(`images/${key}`);
}

/**
 * Upload a site asset (favicon, theme images) to R2 with a fixed key.
 * No DB record; overwrites in place on re-upload.
 */
export async function putSiteAsset(
  env: Env,
  file: File,
  assetPath: string,
): Promise<{ key: string; url: string }> {
  const key = `asset/${assetPath}`;
  
  // ✅ 物理存储：带上 images/ 前缀
  await env.R2.put(`images/${key}`, file.stream(), {
    httpMetadata: {
      contentType: file.type,
    },
  });
  
  // ✅ 特殊处理：这里返回相对路径（以 / 开头），满足系统设置的校验规则。
  // 同时，将来前端通过 getPublicImageSrc 渲染时，会自动拼成完整 R2 链接。
  return { key, url: `/images/${key}` };
}
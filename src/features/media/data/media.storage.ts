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
  // ✅ 物理存储：把系统设置里的静态资源统一放进 asset/themes/fuwari/ 目录
  const key = `asset/themes/fuwari/${assetPath}`;
  
  await env.R2.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
    },
  });
  
  // ✅ 返回相对路径（/ 开头），满足系统设置输入框的校验规则
  return { key, url: `/${key}` };
}
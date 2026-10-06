import { generateKey, R2_PUBLIC_DOMAIN } from "@/features/media/utils/media.utils";

export async function putToR2(
  env: Env,
  image: File,
  key = generateKey(image.name),
) {
  const contentType = image.type;
  const url = `${R2_PUBLIC_DOMAIN}/images/${key}`;
  await env.R2.put(`images/${key}`, image.stream(), {
    httpMetadata: { contentType },
    customMetadata: { originalName: image.name },
  });
  return { key, url, fileName: image.name, mimeType: contentType, sizeInBytes: image.size };
}

export async function deleteFromR2(env: Env, key: string) {
  await env.R2.delete(`images/${key}`);
}

export async function getFromR2(env: Env, key: string) {
  return await env.R2.get(`images/${key}`);
}

export async function putSiteAsset(
  env: Env,
  file: File,
  assetPath: string,
): Promise<{ key: string; url: string }> {
  // ✅ 确认一下：这里直接是 asset/，没有 images/
  const key = `asset/${assetPath}`;

  // 这里如果报错，我们再排查
  await env.R2.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  // ✅ 返回正确链接
  return { key, url: `https://img.ryn.us.ci/${key}?v=${Date.now()` };
}
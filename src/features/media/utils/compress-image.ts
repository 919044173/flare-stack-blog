// src/features/media/utils/compress-image.ts

export type CompressOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: "webp" | "jpeg";
  skipIfSmallerThan?: number;
};

export type CompressResult = {
  file: File;
  originalSize: number;
  compressedSize: number;
  compressed: boolean;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
};

const DEFAULTS: Required<CompressOptions> = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.82,
  format: "webp",
  skipIfSmallerThan: 200 * 1024,
};

const SKIP_MIMES = new Set([
  "image/gif",
  "image/svg+xml",
  "image/apng",
  "image/avif",
]);

export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const opts = { ...DEFAULTS, ...options };

  const fallback = (): CompressResult => ({
    file,
    originalSize: file.size,
    compressedSize: file.size,
    compressed: false,
    originalWidth: 0,
    originalHeight: 0,
    width: 0,
    height: 0,
  });

  if (SKIP_MIMES.has(file.type)) return fallback();
  if (file.size <= opts.skipIfSmallerThan) return fallback();

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
  } catch {
    return fallback();
  }

  const { width: ow, height: oh } = bitmap;
  const scale = Math.min(1, opts.maxWidth / ow, opts.maxHeight / oh);
  const width = Math.max(1, Math.round(ow * scale));
  const height = Math.max(1, Math.round(oh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return fallback();
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const mime = opts.format === "jpeg" ? "image/jpeg" : "image/webp";
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), mime, opts.quality),
  );

  if (!blob || blob.size >= file.size) return fallback();

  const ext = opts.format === "jpeg" ? "jpg" : "webp";
  const base = file.name.replace(/\.[^.]+$/, "");
  const newName = `${base}.${ext}`;

  const compressedFile = new File([blob], newName, {
    type: mime,
    lastModified: Date.now(),
  });

  return {
    file: compressedFile,
    originalSize: file.size,
    compressedSize: blob.size,
    compressed: true,
    originalWidth: ow,
    originalHeight: oh,
    width,
    height,
  };
}
// src/features/posts/editor/extensions/upload-image/index.ts

import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { compressImage } from "@/features/media/utils/compress-image";

export interface ImageUploadResult {
  url: string;
  width?: number;
  height?: number;
}

interface ImageUploadOptions {
  onUpload: (file: File) => Promise<ImageUploadResult>;
  onError?: (error: Error) => void;
  /** 可选：覆盖默认压缩参数 */
  compress?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    format?: "webp" | "jpeg";
    skipIfSmallerThan?: number;
  };
  /** 可选：是否启用压缩，默认 true */
  enableCompress?: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    imageUpload: {
      uploadImage: (file: File, pos?: number) => ReturnType;
    };
  }
}

function findImagePosByUploadId(view: EditorView, uploadId: string) {
  let found: number | null = null;
  view.state.doc.descendants((descendant: ProseMirrorNode, nodePos: number) => {
    if (found != null) return false;
    if (
      descendant.type.name === "image" &&
      descendant.attrs.uploadId === uploadId
    ) {
      found = nodePos;
      return false;
    }
    return true;
  });
  return found;
}

export const ImageUpload = Extension.create<ImageUploadOptions>({
  name: "imageUpload",

  addOptions() {
    return {
      onUpload: async () => ({ url: "" }),
      onError: undefined,
      compress: undefined,
      enableCompress: true,
    };
  },

  addCommands() {
    return {
      uploadImage:
        (file: File, pos?: number) =>
        ({ tr, dispatch, state, view }) => {
          if (!dispatch) return true;

          const uploadId = crypto.randomUUID();
          const insertPos = pos ?? tr.selection.from;

          // 先插入空 src 占位符
          const placeholder = state.schema.nodes.image.create({
            src: "",
            alt: file.name,
            uploadId,
          });
          tr.insert(insertPos, placeholder);

          void (async () => {
            let previewUrl: string | null = null;
            let compressedFile = file;

            try {
              // 1. 压缩（失败退回原文件）
              if (this.options.enableCompress) {
                try {
                  const result = await compressImage(
                    file,
                    this.options.compress,
                  );
                  compressedFile = result.file;

                  if (result.compressed) {
                    console.log(
                      `[imageUpload] ${(result.originalSize / 1024).toFixed(0)}KB → ` +
                        `${(result.compressedSize / 1024).toFixed(0)}KB ` +
                        `(${result.originalWidth}x${result.originalHeight} → ` +
                        `${result.width}x${result.height})`,
                    );
                  }
                } catch (err) {
                  console.warn(
                    "[imageUpload] compress failed, using original",
                    err,
                  );
                }
              }

              if (view.isDestroyed) return;

              // 2. 用（压缩后的）文件生成预览
              previewUrl = URL.createObjectURL(compressedFile);
              const previewNodePos = findImagePosByUploadId(view, uploadId);
              if (previewNodePos == null) {
                URL.revokeObjectURL(previewUrl);
                return;
              }
              const previewCurrent = view.state.doc.nodeAt(previewNodePos);
              if (!previewCurrent) {
                URL.revokeObjectURL(previewUrl);
                return;
              }
              view.dispatch(
                view.state.tr.setNodeMarkup(previewNodePos, undefined, {
                  ...previewCurrent.attrs,
                  src: previewUrl,
                }),
              );

              // 3. 上传压缩后的文件
              const result = await this.options.onUpload(compressedFile);

              if (view.isDestroyed) {
                URL.revokeObjectURL(previewUrl);
                return;
              }
              const nodePos = findImagePosByUploadId(view, uploadId);
              if (nodePos == null) {
                URL.revokeObjectURL(previewUrl);
                return;
              }
              const current = view.state.doc.nodeAt(nodePos);
              if (!current) {
                URL.revokeObjectURL(previewUrl);
                return;
              }

              // 4. 用真实 URL 替换预览
              view.dispatch(
                view.state.tr.setNodeMarkup(nodePos, undefined, {
                  ...current.attrs,
                  src: result.url,
                  width: result.width || current.attrs.width,
                  height: result.height || current.attrs.height,
                  uploadId: null,
                }),
              );
              URL.revokeObjectURL(previewUrl);
            } catch (error) {
              console.error("[imageUpload] Upload failed", error);
              this.options.onError?.(
                error instanceof Error ? error : new Error(String(error)),
              );

              // 5. 上传失败：移除占位符
              if (view.isDestroyed) {
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                return;
              }
              const nodePos = findImagePosByUploadId(view, uploadId);
              if (nodePos != null) {
                const current = view.state.doc.nodeAt(nodePos);
                view.dispatch(
                  view.state.tr.delete(
                    nodePos,
                    nodePos + (current?.nodeSize ?? 1),
                  ),
                );
              }
              if (previewUrl) URL.revokeObjectURL(previewUrl);
            }
          })();

          return true;
        },
    };
  },
});
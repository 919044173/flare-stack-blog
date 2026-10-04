import type { JSONContent } from "@tiptap/react";

export interface PostEditorCover {
  id: number;
  key: string;
  url: string;
  fileName: string;
  width: number | null;
  height: number | null;
}

export interface PostEditorData {
  title: string;
  summary: string;
  slug: string;
  contentJson: JSONContent | null;
  publishedAt: Date | null;
  pinnedAt: Date | null;
  tagIds: Array<number>;
  categoryId: number | null;
  hasPublicSnapshot: boolean;
  serverToday: string;
  coverMediaId: number | null;
  cover: PostEditorCover | null;
  coverIsManual: boolean;   // ✅ 新增
}

export interface PostEditorProps {
  initialData: PostEditorData & {
    id: number;
    publicSnapshotContentJson?: JSONContent | null;
  };
  onSave: (data: PostEditorData) => Promise<void>;
}

export type SaveStatus = "SYNCED" | "SAVING" | "PENDING" | "ERROR";
import { formatPublicPostDate } from "@/features/posts/utils/format-public-post-date";
import { getPublicImageSrc, PUBLIC_IMAGE_WIDTH } from "@/features/media/utils/media.utils";
import { ClientOnly, Link } from "@tanstack/react-router";
import { MoreHorizontal, Pin, Trash2 } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { MOTION, useMotionPresence } from "@/hooks/use-motion";
import { formatDate } from "@/lib/utils";
import { m } from "@/paraglide/messages";
import type { TaxonomyReturn } from "@/components/admin/taxonomy-state";
import type { AdminPostListItem, SortField } from "../types";

interface PostRowProps {
  post: AdminPostListItem;
  sortBy: SortField;
  editorState?: () => { taxonomyReturn: TaxonomyReturn };
  onDelete: (
    post: AdminPostListItem,
    trigger: HTMLButtonElement | null,
  ) => void;
}

export function PostRow({ post, sortBy, onDelete, editorState }: PostRowProps) {
  const rawTitle = post.title.trim();
  const title = rawTitle || m.common_untitled();
  const date = post[sortBy];

  // ✅ 无标题时用摘要兜底
  const displayText = rawTitle
    ? rawTitle
    : post.summary?.trim() || m.common_untitled();

  return (
    <tr>
      <td>
        <div className="post-list-title-cell">
          {/* ✅ 封面缩略图 */}
          {post.cover ? (
            <Link
              to="/admin/posts/edit/$id"
              params={{ id: String(post.id) }}
              state={editorState}
              className="post-list-cover"
              aria-label={title}
            >
              <img
                src={getPublicImageSrc(post.cover.url, PUBLIC_IMAGE_WIDTH.cover)}
                alt=""
                loading="lazy"
                className="post-list-cover-img"
              />
            </Link>
          ) : (
            <span className="post-list-cover post-list-cover-empty" aria-hidden="true" />
          )}

          <span className="post-list-pin">
            {post.pinnedAt && (
              <Pin size={18} aria-label={m.admin_posts_pinned()} />
            )}
          </span>
          <Link
            to="/admin/posts/edit/$id"
            params={{ id: String(post.id) }}
            state={editorState}
            className="post-list-title-link"
          >
            <strong>{displayText}</strong>
            <span>{post.slug || m.admin_posts_slug_empty()}</span>
          </Link>
        </div>
      </td>
      <td>
        <span className={`post-list-status ${post.status}`}>
          {post.status === "published"
            ? m.admin_posts_status_published()
            : m.admin_posts_status_draft()}
        </span>
      </td>
      <td className="post-list-date">
        <span className="post-list-mobile-date-label">
          {sortBy === "publishedAt"
            ? m.admin_posts_time_published()
            : m.admin_posts_time_modified()}{" "}
        </span>
        {date ? (
          <time dateTime={date.toISOString()}>
            {sortBy === "publishedAt" ? (
              formatPublicPostDate(date)
            ) : (
              <ClientOnly fallback="—">{formatDate(date)}</ClientOnly>
            )}
          </time>
        ) : (
          "—"
        )}
      </td>
      <td>
        <div className="post-list-row-actions">
          <Link
            to="/admin/posts/edit/$id"
            params={{ id: String(post.id) }}
            state={editorState}
            aria-label={m.admin_posts_edit_named({ title })}
          >
            {m.admin_posts_action_edit()}
          </Link>
          <PostRowMenu
            title={title}
            onDelete={(trigger) => onDelete(post, trigger)}
          />
        </div>
      </td>
    </tr>
  );
}

function PostRowMenu({
  title,
  onDelete,
}: {
  title: string;
  onDelete: (trigger: HTMLButtonElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const present = useMotionPresence(open, MOTION.popover);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!present) {
      setPosition(null);
      return;
    }
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const above = window.innerHeight - rect.bottom < 100;
    setPosition({
      right: Math.max(8, window.innerWidth - rect.right),
      top: above ? undefined : rect.bottom + 4,
      bottom: above ? window.innerHeight - rect.top + 4 : undefined,
      transformOrigin: above ? "bottom right" : "top right",
    });
    const close = () => setOpen(false);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, present]);
  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true });
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open, position]);
  return (
    <div className="post-list-menu">
      <button
        ref={triggerRef}
        type="button"
        aria-label={m.admin_posts_more_named({ title })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={18} />
      </button>
      {present && position
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={m.admin_posts_more_named({ title })}
              className="post-row-menu fuwari-popover-motion"
              data-state={open ? "open" : "closed"}
              style={position}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onDelete(triggerRef.current);
                  setOpen(false);
                }}
              >
                <Trash2 size={15} />
                {m.admin_posts_action_delete()}
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";

export interface NotificationEntry {
  id: string;
  title: string;
  body?: string;
  /** `info`, `warning`, `danger` : table `notifications`. */
  severity?: "info" | "warning" | "danger";
  /** Date lisible, déjà formatée (`il y a 2 h`). */
  date?: string;
  href?: string;
  unread?: boolean;
}

const SEVERITY_DOT = {
  info: "bg-accent",
  warning: "bg-warn",
  danger: "bg-danger",
};

/** Liste de notifications, partagée par la cloche et le menu du profil. */
export function NotificationList({
  items,
  onNavigate,
}: {
  items: readonly NotificationEntry[];
  onNavigate?: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <span className="flex size-7 items-center justify-center rounded-sm bg-surface-raised text-muted">
          <Icon name="bell" size={16} />
        </span>
        <p className="text-sm text-muted">Aucune notification pour le moment.</p>
      </div>
    );
  }
  return (
    <ul className="flex max-h-[min(420px,60dvh)] flex-col gap-1 overflow-y-auto p-2">
      {items.map((item) => {
        const content = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                SEVERITY_DOT[item.severity ?? "info"],
                !item.unread && "opacity-30",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm text-text", item.unread && "font-semibold")}>
                {item.title}
                {item.unread ? <span className="sr-only"> (non lue)</span> : null}
              </span>
              {item.body ? (
                <span className="mt-0.5 block text-xs text-muted">{item.body}</span>
              ) : null}
            </span>
            {item.date ? (
              <span className="shrink-0 pt-0.5 font-mono text-amount-compact text-muted">
                {item.date}
              </span>
            ) : null}
          </>
        );
        const classes = "flex items-start gap-2 rounded-sm px-2 py-2";
        return (
          <li key={item.id}>
            {item.href ? (
              <Link
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  classes,
                  "min-h-11 hover:bg-surface-raised focus-visible:bg-surface-raised",
                )}
              >
                {content}
              </Link>
            ) : (
              <div className={classes}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Cloche et son panneau (Figma 58:249, 36 × 36, zone cliquable 44), posée dans `PageHeader.bell`.
 * Figma ne dessine pas le panneau. `items` vient de `src/modules/platform/notifications.service`.
 */
export function NotificationBell({
  items,
  unreadCount,
  allHref,
}: {
  items: readonly NotificationEntry[];
  /** Défaut : les entrées `unread` de `items`. */
  unreadCount?: number;
  /** Lien « Tout voir ». */
  allHref?: string;
}) {
  const count = unreadCount ?? items.filter((item) => item.unread).length;
  return (
    <Popover
      label="Notifications"
      placement="bottom-end"
      initialFocus="panel"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={count > 0 ? `Notifications, ${count} non lues` : "Notifications"}
          className="hit-44 relative flex size-9 items-center justify-center rounded-md border border-border bg-surface text-ink transition-colors duration-(--dur-fast) hover:bg-surface-raised"
        >
          <Icon name="bell" size={18} />
          {count > 0 ? (
            <span
              aria-hidden="true"
              className="tabular absolute -top-1 -right-1 min-w-4 rounded-full bg-accent px-1 text-center text-nav-counter text-on-accent"
            >
              {count}
            </span>
          ) : null}
        </button>
      )}
    >
      {(close) => (
        <div className="w-[min(360px,calc(100vw-16px))]">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <p className="flex-1 text-tile-title text-ink">Notifications</p>
            {count > 0 ? <Badge tone="accent">{count}</Badge> : null}
          </div>
          <NotificationList items={items} onNavigate={close} />
          {allHref ? (
            <div className="border-t border-border p-2">
              <Link
                href={allHref}
                onClick={close}
                className="flex min-h-11 items-center justify-center rounded-sm text-sm font-medium text-accent hover:bg-surface-raised"
              >
                Tout voir
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </Popover>
  );
}

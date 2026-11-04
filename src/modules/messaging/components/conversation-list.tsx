"use client";

import { LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { useLinkStatus } from "next/link";
import { RollingNumber } from "@/components/motion/rolling-number";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

export interface ConversationListItem {
  id: string;
  href: string;
  title: string;
  initials: string;
  time: string;
  excerpt: string;
  unread: number;
  ready: boolean;
}

function PendingVeil() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span aria-hidden="true" className="anim-pulse absolute inset-0 bg-accent-pale/60" />
  ) : null;
}

/**
 * Lignes de conversation (écran 02). Un message reçu fait remonter la ligne à sa nouvelle place,
 * sans rien faire clignoter ; la ligne active est sur fond `--accent-pale`.
 */
export function ConversationList({
  items,
  activeId,
}: {
  items: readonly ConversationListItem[];
  activeId?: string;
}) {
  const preset = useMotionPreset();
  return (
    <LayoutGroup>
      <ul className="flex flex-col">
        {items.map((item) => (
          <motion.li key={item.id} layout="position" transition={preset.move}>
            <Link
              href={item.href}
              scroll={false}
              aria-current={item.id === activeId ? "page" : undefined}
              className={cn(
                "relative flex items-start gap-3 px-5 py-3 transition-colors duration-(--dur-fast) ease-out",
                item.id === activeId ? "bg-accent-pale" : "hover:bg-surface-raised",
              )}
            >
              <PendingVeil />
              <Avatar initials={item.initials} size={36} className="relative mt-1" />
              <span className="relative flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-row-primary text-ink">{item.title}</span>
                  <span className="shrink-0 font-mono text-amount-compact text-muted">
                    {item.time}
                  </span>
                </span>
                <span className="flex items-start justify-between gap-2">
                  <span
                    className={cn(
                      "line-clamp-1 min-w-0 flex-1 text-row-secondary",
                      item.unread > 0 ? "font-medium text-text" : "text-muted",
                    )}
                  >
                    {item.excerpt}
                  </span>
                  {item.unread > 0 ? (
                    <span
                      className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-nav-counter text-on-accent"
                      aria-label={`${item.unread} non lu${item.unread > 1 ? "s" : ""}`}
                    >
                      <RollingNumber value={item.unread} countUp={false} />
                    </span>
                  ) : null}
                </span>
                {item.ready ? (
                  <span className="flex items-center gap-1 text-[11px] leading-none font-medium text-chatgpt">
                    <Icon name="sparkle" size={12} />
                    Réponse suggérée
                  </span>
                ) : null}
              </span>
            </Link>
          </motion.li>
        ))}
      </ul>
    </LayoutGroup>
  );
}

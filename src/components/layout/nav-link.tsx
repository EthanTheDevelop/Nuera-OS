"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { RollingNumber } from "@/components/motion/rolling-number";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

function isActive(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) =>
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Entrée de la barre latérale (Figma §2.1). Inactive : 500 14 `--accent-on-dark`.
 * Active : fond `--hairline-on-dark`, 600 14 `--paper`. Compteur : pilule `--accent`, 600 11.
 */
export function NavLink({
  href,
  icon,
  label,
  counter,
  activePrefixes,
  index,
  onNavigate,
}: {
  href: string;
  icon: IconName;
  label: string;
  counter?: number;
  activePrefixes?: readonly string[];
  /** Rang dans la cascade d'arrivée (30 ms d'écart). */
  index: number;
  onNavigate?: () => void;
}) {
  const active = isActive(usePathname(), activePrefixes ?? [href]);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      style={{ "--i": index } as CSSProperties}
      className={cn(
        "anim-frame flex min-h-[34px] items-center gap-3 rounded-sm px-3 py-2 text-nav outline-none [@media(max-height:940px)_and_(pointer:fine)_and_(min-width:1024px)]:min-h-7 [@media(max-height:940px)_and_(pointer:fine)_and_(min-width:1024px)]:py-1",
        "transition-colors duration-(--dur-fast) ease-out max-lg:min-h-11 pointer-coarse:min-h-11",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-on-dark",
        active
          ? "bg-hairline-on-dark font-semibold text-paper"
          : "font-medium text-accent-on-dark hover:bg-surface-raised-dark hover:text-paper",
      )}
    >
      <Icon name={icon} size={18} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {counter !== undefined && counter > 0 ? (
        <span className="tabular rounded-full bg-accent-on-light px-1 py-px text-center text-nav-counter text-paper">
          <RollingNumber value={counter} countUp={false} />
          <span className="sr-only"> à traiter</span>
        </span>
      ) : null}
    </Link>
  );
}

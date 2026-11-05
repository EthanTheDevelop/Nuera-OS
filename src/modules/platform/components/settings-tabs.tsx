"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/** Onglets de Réglages (écran 05) : de vrais liens, l'actif sur fond `--accent-pale`. */
export function SettingsTabs({ tabs }: { tabs: readonly { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Réglages"
      className="anim-header -mx-1 flex max-w-full [scrollbar-width:none] items-center gap-1 overflow-x-auto px-1"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "hit-44 shrink-0 rounded-full px-2 py-1 text-badge whitespace-nowrap transition-colors duration-(--dur-fast) ease-out",
              active ? "bg-accent-pale text-accent" : "text-text hover:bg-surface-raised",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

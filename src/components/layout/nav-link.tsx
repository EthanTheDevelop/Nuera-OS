"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Entrée de navigation ; seule partie cliente de la sidebar (état actif). */
export function NavLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  const active = isActive(usePathname(), href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2 [&_svg]:size-4 [&_svg]:shrink-0",
        "focus-visible:outline-2 focus-visible:outline-accent",
        active ? "bg-subtle font-medium text-ink" : "text-ink-muted hover:bg-subtle hover:text-ink",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}

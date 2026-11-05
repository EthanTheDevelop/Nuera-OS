"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { Logo } from "@/components/layout/logo";
import { useSignOut } from "@/components/layout/profile-menu";
import { Avatar } from "@/components/ui/avatar";
import { Icon, type IconName } from "@/components/ui/icon";
import {
  MenuItem,
  MenuList,
  MenuSeparator,
  Popover,
  type MenuEntry,
} from "@/components/ui/popover";
import { ProgressRing, type RingStep } from "@/components/ui/progress-ring";
import { cn } from "@/lib/cn";

const TABS: readonly { key: CapsuleTab; label: string; icon: IconName; href: string }[] = [
  { key: "project", label: "Mon projet", icon: "projets", href: "/espace" },
  { key: "messages", label: "Messages", icon: "messages", href: "/espace/messages" },
  { key: "documents", label: "Documents", icon: "devis", href: "/espace/documents" },
  { key: "site", label: "Mon site", icon: "sites", href: "/espace/mon-site" },
];

export type CapsuleTab = "project" | "messages" | "documents" | "site";

function tabFromPath(pathname: string): CapsuleTab | null {
  if (pathname === "/espace") return "project";
  return TABS.find((tab) => tab.href !== "/espace" && pathname.startsWith(tab.href))?.key ?? null;
}

/**
 * Capsule de l'espace client (figma-map §2.3, Figma 69:1289).
 * L'onglet actif se déduit de l'URL. `/espace/profil` n'en active aucun (variante « Aucun »).
 * Sur écran étroit, elle passe sur deux rangées ; les onglets gardent leur icône et leur nom accessible.
 */
export function ClientCapsule({
  active,
  progress,
  nextAction,
  messagesCount,
  user,
  menuItems = [],
  signOutRedirect = "/espace/connexion",
  className,
}: {
  /** Impose l'onglet actif. Défaut : déduit de l'URL. `null` : aucun. */
  active?: CapsuleTab | null;
  /** Absent : pas de projet en cours, la pastille d'avancement disparaît. */
  progress?: {
    /** Un état par étape : `done`, `current`, `todo`. */
    steps: readonly RingStep[];
    /** Nom de l'étape en cours (`Maquettes`). */
    label: string;
    /** Nom accessible complet (`Avancement : étape 2 sur 4, maquettes, mise en ligne le 18 novembre`). */
    ariaLabel: string;
    /** Bulle au survol (`Mise en ligne le 18 novembre`). */
    hint?: string;
  };
  /** Prochaine action du client (`À vous : déposer les photos`). */
  nextAction?: { label: string; href: string };
  messagesCount?: number;
  user: { name: string; email?: string };
  /** Entrées du menu (C5), liens uniquement. « Se déconnecter » est ajouté automatiquement. */
  menuItems?: readonly MenuEntry[];
  signOutRedirect?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const activeTab = active === undefined ? tabFromPath(pathname) : active;
  const uid = useId();
  const preset = useMotionPreset();
  const { signOut, pending } = useSignOut(signOutRedirect);

  // Une seule barre d'onglets, repositionnée par `order` : une copie masquée volerait le `layoutId`
  // de l'onglet actif et le rendrait invisible.
  return (
    <header
      className={cn(
        "anim-header flex h-auto items-center px-3 py-3 sm:px-10 xl:h-(--client-capsule-h) xl:py-0",
        className,
      )}
    >
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-[32px] bg-near-black px-3 py-2 shadow-capsule min-[900px]:px-4 xl:flex-nowrap xl:rounded-full">
        <Link href="/espace" aria-label="Accueil de mon espace" className="shrink-0 rounded-sm">
          <Logo width={103} />
        </Link>
        {progress ? (
          <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border-on-dark" />
        ) : null}
        {progress ? (
          <Link
            href="/espace"
            aria-label={progress.ariaLabel}
            className="group relative flex min-w-0 shrink-0 items-center gap-2.5 rounded-full bg-surface-raised-dark py-1.5 pr-3 pl-1.5 text-nav font-medium text-paper transition-colors duration-(--dur-fast) outline-none hover:bg-hairline-on-dark focus-visible:outline-2 focus-visible:outline-accent-on-dark"
          >
            <ProgressRing steps={progress.steps} onDark />
            <span className="min-w-0 truncate">{progress.label}</span>
            <Icon name="chevron" size={14} />
            {progress.hint ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-full left-0 z-30 mt-2 rounded-sm bg-near-black px-3 py-1.5 text-xs whitespace-nowrap text-paper opacity-0 shadow-menu transition-opacity duration-(--dur-fast) group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {progress.hint}
              </span>
            ) : null}
          </Link>
        ) : null}
        <div className="flex-1" />
        <nav
          aria-label="Espace client"
          className="order-1 min-w-0 basis-full min-[900px]:order-none min-[900px]:basis-auto"
        >
          <ul className="flex items-center gap-1 rounded-full bg-surface-raised-dark p-1">
            {TABS.map((tab) => {
              const selected = tab.key === activeTab;
              const counter = tab.key === "messages" ? messagesCount : undefined;
              return (
                <li key={tab.key} className="relative max-[899px]:flex-1">
                  {selected ? (
                    <motion.span
                      layoutId={`${uid}-tab`}
                      transition={preset.tab}
                      className="absolute inset-0 rounded-full bg-paper shadow-capsule-tab"
                    />
                  ) : null}
                  <Link
                    href={tab.href}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "relative flex h-10 items-center justify-center gap-2 rounded-full pr-4 pl-3.5 text-nav whitespace-nowrap outline-none max-[899px]:h-11 max-[899px]:px-2",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-on-dark",
                      "transition-colors duration-(--dur-fast)",
                      selected
                        ? "font-semibold text-near-black"
                        : "font-medium text-accent-on-dark hover:text-paper",
                    )}
                  >
                    <Icon name={tab.icon} size={18} />
                    <span className="max-[479px]:sr-only">{tab.label}</span>
                    {counter ? (
                      <span className="tabular rounded-full bg-accent-on-light px-1 py-px text-nav-counter text-paper">
                        {counter}
                        <span className="sr-only"> non lus</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex-1 max-[899px]:hidden" />
        {nextAction ? (
          <Link
            href={nextAction.href}
            className="order-2 flex min-h-11 shrink-0 basis-full items-center gap-2 rounded-full bg-hairline-on-dark py-2 pr-2.5 pl-3 text-nav-search font-medium text-paper transition-colors duration-(--dur-fast) outline-none hover:bg-border-on-dark focus-visible:outline-2 focus-visible:outline-accent-on-dark xl:order-none xl:min-h-[34px] xl:basis-auto"
          >
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warn-on-dark" />
            <span className="min-w-0 flex-1 truncate xl:flex-none">{nextAction.label}</span>
            <Icon name="chevron" size={14} />
          </Link>
        ) : null}
        <Popover
          label="Menu du profil"
          placement="bottom-end"
          trigger={(props) => (
            <button
              {...props}
              type="button"
              aria-label={`Menu du profil, ${user.name}`}
              className="hit-44 flex shrink-0 items-center gap-1.5 rounded-full text-accent-on-dark outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-on-dark"
            >
              <Avatar name={user.name} size={36} />
              <Icon name="chevron" size={14} className="rotate-90" />
            </button>
          )}
        >
          {(close) => (
            <div className="flex w-[min(300px,calc(100vw-16px))] flex-col gap-1 p-2">
              <div className="flex items-center gap-3 p-3">
                <Avatar name={user.name} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-tile-title text-ink">{user.name}</p>
                  {user.email ? (
                    <p className="truncate text-xs leading-[1.25] text-muted">{user.email}</p>
                  ) : null}
                </div>
              </div>
              <MenuSeparator />
              <MenuList label="Mon compte">
                {menuItems.map((item) => (
                  <MenuItem
                    key={item.key}
                    icon={item.icon}
                    href={item.href}
                    aside={item.aside}
                    onSelect={close}
                  >
                    {item.label}
                  </MenuItem>
                ))}
                {menuItems.length > 0 ? <MenuSeparator /> : null}
                <MenuItem icon="chevron" danger disabled={pending} onSelect={signOut}>
                  Se déconnecter
                </MenuItem>
              </MenuList>
            </div>
          )}
        </Popover>
      </div>
    </header>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Breadcrumb {
  label: string;
  href?: string;
}

/**
 * En-tête de page agence (figma-map §2.2). Pas de barre haute globale : chaque écran pose le sien.
 *
 * - Gauche : titre 600 28, sous-titre 400 14 (résumé calculé).
 * - Droite : `actions`, 0 à 2 `Button`, Default puis Accent ; l'action principale toujours à droite.
 * - `bell` : `NotificationBell`, écrans 01 et 06 seulement.
 * - `badges` : ligne de badges sous le titre (écrans 04, 17, 19).
 * - `children` : filtres, sous l'en-tête (`FilterBar`).
 * Compatible serveur.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  bell,
  breadcrumbs,
  badges,
  className,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  bell?: ReactNode;
  breadcrumbs?: readonly Breadcrumb[];
  badges?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header
      className={cn("mb-6 flex flex-col gap-6", !children && !badges && "lg:mb-[30px]", className)}
    >
      {breadcrumbs ? (
        <nav
          aria-label="Fil d'Ariane"
          className="anim-header font-mono text-table-head font-normal text-muted"
        >
          <ol className="flex flex-wrap items-center gap-1.5">
            {breadcrumbs.map((crumb, index) => (
              <li key={crumb.label} className="flex items-center gap-1.5">
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="hit-44 hover:text-text">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="anim-header flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-page-title text-ink">{title}</h1>
          {subtitle ? <p className="text-page-subtitle text-muted">{subtitle}</p> : null}
        </div>
        {actions || bell ? (
          <div className="flex flex-wrap items-center gap-3">
            {bell}
            {actions}
          </div>
        ) : null}
      </div>
      {badges ? (
        <div className="anim-header flex flex-wrap items-center gap-2">{badges}</div>
      ) : null}
      {children}
    </header>
  );
}

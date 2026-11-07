import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Hauteur d'écran à partir de 1024 px. La base nulle (`0px`, pas `0%`, ignoré quand la hauteur du parent
 * n'est pas fixée) partage l'espace disponible sans y compter le contenu défilant. La page ne s'allonge
 * que si le contenu fixe et les hauteurs plancher dépassent l'écran : rien n'est coupé.
 */
export const PORTAL_FILL = "lg:flex-[1_1_0px]";
/** Page ou groupe de sections qui occupe la hauteur restante. */
export const PORTAL_PAGE = `flex flex-col gap-6 ${PORTAL_FILL}`;
/** Rangée de colonnes de même hauteur ; ajouter `lg:grid-cols-*`. */
export const PORTAL_ROW = `grid gap-6 lg:grid-rows-[minmax(0,1fr)] ${PORTAL_FILL}`;
/**
 * Liste longue : défile dans sa carte, le reste de la page ne bouge pas. Barre fine, avec une marge
 * qui l'écarte du contenu ; sa place reste réservée pour que rien ne bouge quand elle apparaît.
 */
export const PORTAL_SCROLL = `lg:min-h-24 lg:overflow-y-auto lg:pr-[14px] lg:[scrollbar-color:var(--color-border)_transparent] lg:[scrollbar-gutter:stable] lg:[scrollbar-width:thin] ${PORTAL_FILL}`;

/** Carte du portail (figma-map §2.3) : bordure, rayon 28, sans ombre. Compatible serveur. */
export function PortalCard({
  id,
  title,
  aside,
  description,
  className,
  children,
}: {
  id?: string;
  title?: ReactNode;
  aside?: ReactNode;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "flex min-w-0 scroll-mt-28 flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:p-7",
        className,
      )}
    >
      {title ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {aside ? <div className="text-sm text-muted">{aside}</div> : null}
        </div>
      ) : null}
      {description ? <p className="text-sm text-muted">{description}</p> : null}
      {children}
    </section>
  );
}

/** En-tête de page du portail : titre 44/700, chapô, action. */
export function PortalPageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-center justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-[32px] leading-[1.25] font-bold text-ink sm:text-[44px] lg:text-[length:var(--portal-title)]">
          {title}
        </h1>
        {subtitle ? <p className="mt-1 text-lg font-normal text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

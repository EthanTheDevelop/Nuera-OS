import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

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
        <h1 className="text-[32px] leading-[1.25] font-bold text-ink sm:text-[44px]">{title}</h1>
        {subtitle ? <p className="mt-1 text-lg font-normal text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

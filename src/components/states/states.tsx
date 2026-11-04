import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";

/**
 * États non dessinés dans Figma (figma-map §8), dans le même langage : pastille d'icône d'en-tête de
 * tuile, titre 14/600 ou 20/600, texte `--muted`, action en bouton du Design System.
 * Tous compatibles serveur. Écrits pour vivre dans une tuile, une carte ou une page.
 */
function StateLayout({
  icon,
  tone = "accent",
  title,
  children,
  action,
  compact = false,
  role,
  className,
}: {
  icon: IconName;
  tone?: "accent" | "warn" | "danger" | "neutral";
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Dans une tuile étroite : tout en ligne, sans grand espace. */
  compact?: boolean;
  role?: "alert" | "status";
  className?: string;
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex flex-col items-center gap-3 text-center",
        compact ? "py-4" : "px-4 py-12",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-md",
          compact ? "size-7 rounded-sm" : "size-11",
          tone === "accent" && "bg-accent-pale text-accent",
          tone === "warn" && "bg-warn-pale text-warn",
          tone === "danger" && "bg-danger-pale text-danger",
          tone === "neutral" && "bg-surface-raised text-muted",
        )}
      >
        <Icon name={icon} size={compact ? 16 : 22} />
      </span>
      <div className="flex max-w-md flex-col gap-1">
        <p className={cn("text-ink", compact ? "text-tile-title" : "text-client-card-title")}>
          {title}
        </p>
        {children ? <div className="text-sm leading-[1.45] text-muted">{children}</div> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** Liste vide : dire ce qui viendra ici et comment le créer. */
export function EmptyState({
  icon = "plus",
  title,
  description,
  action,
  compact,
  className,
}: {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <StateLayout
      icon={icon}
      title={title}
      action={action}
      compact={compact}
      tone="neutral"
      className={className}
    >
      {description}
    </StateLayout>
  );
}

/** Erreur inattendue : message générique, référence pour le support, nouvelle tentative. */
export function ErrorState({
  title = "Une erreur est survenue",
  description = "Cette partie n'a pas pu être affichée. Si le problème persiste, transmettez la référence au support.",
  reference,
  action,
  compact,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  /** `error.digest` de Next.js. */
  reference?: string;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <StateLayout
      icon="alert"
      tone="danger"
      role="alert"
      title={title}
      action={action}
      compact={compact}
      className={className}
    >
      <p>{description}</p>
      {reference ? (
        <p className="mt-1 font-mono text-xs text-muted">Référence : {reference}</p>
      ) : null}
    </StateLayout>
  );
}

/** Permission refusée : dit à qui s'adresser, ne révèle rien du contenu. */
export function ForbiddenState({
  title = "Accès réservé",
  description = "Votre rôle ne donne pas accès à cette page. Un associé peut modifier vos droits dans Administration.",
  action,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <StateLayout icon="shield" tone="neutral" title={title} action={action} className={className}>
      {description}
    </StateLayout>
  );
}

/**
 * Intégration absente (`IntegrationUnavailableError`) : jamais de succès simulé.
 * Nomme le service, dit ce qui manque, mène aux réglages.
 */
export function ConnectionRequired({
  service,
  missing,
  settingsHref = "/reglages/connexions",
  settingsLabel = "Ouvrir les connexions",
  compact,
  className,
}: {
  /** `Coolify`, `Uptime Kuma`… */
  service: string;
  /** Ce qui manque : `La clé d'API n'est pas renseignée.` */
  missing: ReactNode;
  settingsHref?: string;
  settingsLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <StateLayout
      icon="link"
      tone="warn"
      role="status"
      compact={compact}
      title={`Connexion requise : ${service}`}
      className={className}
      action={
        compact ? (
          <Link
            href={settingsHref}
            className="hit-44 text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            {settingsLabel}
          </Link>
        ) : (
          <ButtonLink href={settingsHref}>{settingsLabel}</ButtonLink>
        )
      }
    >
      {missing}
    </StateLayout>
  );
}

/**
 * Donnée périmée : l'affichage reste, mais sa date et son âge se lisent.
 * Bandeau à poser au-dessus de la donnée (toute lecture externe porte sa date, domain-model §6).
 */
export function StaleData({
  date,
  staleness,
  service,
  action,
  className,
}: {
  /** Date de la dernière lecture, déjà formatée. */
  date: string;
  /** Âge lisible : `il y a 3 h`. */
  staleness: string;
  service?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-warn-pale px-3 py-2 text-xs text-warn",
        className,
      )}
    >
      <Icon name="clock" size={14} />
      <p className="min-w-0 flex-1">
        Données périmées{service ? ` de ${service}` : ""} : dernière lecture le {date} ({staleness}
        ).
      </p>
      {action}
    </div>
  );
}

/** Pastille de fraîcheur compacte, pour un en-tête de tuile. */
export function StaleBadge({ staleness }: { staleness: string }) {
  return <Badge tone="warn">Périmé · {staleness}</Badge>;
}

const SHIMMER = "anim-pulse rounded-sm bg-surface-raised";

function Bone({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block", SHIMMER, className)} />;
}

const Loading = ({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) => (
  <div role="status" aria-label={label} className={className}>
    {children}
    <span className="sr-only">{label}</span>
  </div>
);

/** Squelette de tuile : même rayon, même ombre, en-tête et lignes au bon endroit. */
export function TileSkeleton({
  lines = 2,
  label = "Chargement",
  className,
}: {
  lines?: number;
  label?: string;
  className?: string;
}) {
  return (
    <Loading
      label={label}
      className={cn(
        "flex min-h-[168px] flex-col gap-(--tile-gap) rounded-xl bg-surface p-(--tile-pad) shadow-soft",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Bone className="size-7 rounded-sm" />
        <Bone className="h-3.5 w-24" />
      </div>
      <Bone className="mt-auto h-7 w-20" />
      {Array.from({ length: lines }, (_, index) => (
        <Bone key={index} className={cn("h-3", index % 2 ? "w-1/2" : "w-3/4")} />
      ))}
    </Loading>
  );
}

/** Squelette de carte KPI. */
export function KpiSkeleton({
  label = "Chargement",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Loading
      label={label}
      className={cn("flex flex-col gap-2 rounded-lg bg-surface p-6 shadow-soft", className)}
    >
      <Bone className="h-3 w-20" />
      <Bone className="h-6 w-24" />
      <Bone className="h-3 w-28" />
    </Loading>
  );
}

/** Squelette de tableau : en-tête 45, lignes à la hauteur de l'écran. */
export function TableSkeleton({
  rows = 6,
  columns = 4,
  rowHeight = "sm",
  label = "Chargement du tableau",
  className,
}: {
  rows?: number;
  columns?: number;
  rowHeight?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}) {
  const height =
    rowHeight === "lg"
      ? "h-(--row-h-lg)"
      : rowHeight === "md"
        ? "h-(--row-h-md)"
        : "h-(--row-h-sm)";
  return (
    <Loading
      label={label}
      className={cn("overflow-hidden rounded-lg bg-surface shadow-soft", className)}
    >
      <div className="flex h-[45px] items-center gap-4 border-b border-border px-5">
        {Array.from({ length: columns }, (_, column) => (
          <Bone
            key={column}
            className={cn("h-2.5", column === 0 ? "w-32 flex-[2]" : "w-16 flex-1")}
          />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className={cn(
            "flex items-center gap-4 border-b border-border px-5 last:border-b-0",
            height,
          )}
        >
          {Array.from({ length: columns }, (_, column) => (
            <Bone key={column} className={cn("h-3", column === 0 ? "flex-[2]" : "flex-1")} />
          ))}
        </div>
      ))}
    </Loading>
  );
}

/** Squelette générique de page : pour `loading.tsx`. */
export function LoadingSkeleton({
  variant = "table",
  className,
}: {
  variant?: "table" | "tiles";
  className?: string;
}) {
  return variant === "tiles" ? (
    <div
      className={cn("grid grid-cols-1 gap-(--grid-gap) sm:grid-cols-2 lg:grid-cols-3", className)}
    >
      {Array.from({ length: 6 }, (_, index) => (
        <TileSkeleton key={index} />
      ))}
    </div>
  ) : (
    <TableSkeleton className={className} />
  );
}

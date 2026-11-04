import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type NoteTone = "muted" | "success" | "warn" | "danger";

const NOTE_TONES: Record<NoteTone, string> = {
  muted: "text-muted",
  success: "text-success",
  warn: "text-warn",
  danger: "text-danger",
};

/** Contenu commun à la carte KPI et à l'onglet KPI : libellé 12/500, chiffre 26/600, note 12. */
export function KpiContent({
  label,
  value,
  note,
  noteTone = "muted",
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  noteTone?: NoteTone;
}) {
  return (
    <>
      <span className="text-kpi-label text-muted">{label}</span>
      <span className="tabular text-figure text-ink">{value}</span>
      {note ? <span className={cn("text-kpi-note", NOTE_TONES[noteTone])}>{note}</span> : null}
    </>
  );
}

/**
 * Carte KPI (Figma 100:4558) : rayon 20, `Shadow/Soft`, `padding 24`, gap 4.
 * Pour des cartes qui pilotent un graphique (écran 16), voir `KpiTabs` dans `tabs.tsx`.
 */
export function KpiCard({
  label,
  value,
  note,
  noteTone,
  href,
  className,
}: {
  label: ReactNode;
  /** Valeur déjà formatée, ou un `RollingNumber`. */
  value: ReactNode;
  note?: ReactNode;
  noteTone?: NoteTone;
  href?: string;
  className?: string;
}) {
  const classes = cn(
    "anim-content flex min-w-0 flex-col gap-1 rounded-lg bg-surface p-6 shadow-soft",
    href && "transition-shadow duration-(--dur-fast) hover:shadow-float",
    className,
  );
  const content = <KpiContent label={label} value={value} note={note} noteTone={noteTone} />;
  return href ? (
    <Link href={href} className={classes}>
      {content}
    </Link>
  ) : (
    <div className={classes}>{content}</div>
  );
}

/** Rangée de cartes KPI : 4 en ligne, gap 24, repliées en 2 puis 1 colonne selon la largeur. */
export function KpiGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="@container">
      <div
        className={cn(
          "grid grid-cols-1 gap-(--grid-gap) @md:grid-cols-2 @4xl:grid-cols-4",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

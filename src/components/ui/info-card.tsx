import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { IconName } from "./icon";
import { Tile } from "./tile";

/** Une ligne libellé / valeur (`dt` / `dd`). */
export function InfoRow({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-5 items-center justify-between gap-3 text-sm", className)}>
      <dt className="min-w-0 text-text">{label}</dt>
      <dd className="tabular min-w-0 text-right text-text">{value}</dd>
    </div>
  );
}

/** Liste de lignes libellé / valeur, sémantique `dl`. */
export function InfoRows({
  rows,
  className,
}: {
  rows: readonly { label: ReactNode; value: ReactNode; key?: string }[];
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-col gap-2", className)}>
      {rows.map((row, index) => (
        <InfoRow key={row.key ?? index} label={row.label} value={row.value} />
      ))}
    </dl>
  );
}

/**
 * Carte d'information (Figma 100:5107) : en-tête de tuile + lignes libellé / valeur.
 * `children` s'ajoute sous les lignes (jauge, note d'écart…). Compatible serveur.
 */
export function InfoCard({
  icon,
  title,
  aside,
  rows,
  className,
  children,
}: {
  icon: IconName;
  title: ReactNode;
  aside?: ReactNode;
  rows?: readonly { label: ReactNode; value: ReactNode; key?: string }[];
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Tile icon={icon} title={title} aside={aside} className={cn("gap-3 rounded-lg p-6", className)}>
      {rows ? <InfoRows rows={rows} /> : null}
      {children}
    </Tile>
  );
}

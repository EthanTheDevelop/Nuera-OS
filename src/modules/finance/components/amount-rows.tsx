import type { ReactNode } from "react";
import { InfoRow } from "@/components/ui/info-card";

/**
 * Lignes libellé / montant : le montant garde sa largeur et c'est le libellé qui passe à la ligne.
 * Contrairement à `InfoRows`, un montant ne passe jamais à la ligne, même très long.
 */
export function AmountRows({
  rows,
}: {
  rows: readonly { key: string; label: ReactNode; value: ReactNode }[];
}) {
  return (
    <dl className="flex flex-col gap-2">
      {rows.map((row) => (
        <InfoRow
          key={row.key}
          label={row.label}
          value={row.value}
          className="[&>dd]:shrink-0 [&>dd]:whitespace-nowrap"
        />
      ))}
    </dl>
  );
}

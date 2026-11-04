import { TableSkeleton } from "@/components/states/states";

/** Chargement des listes (échéancier, coûts, imports, rentabilité). Les détails répondent en vrai 404. */
export default function FinanceListLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="h-[60px]" />
      <TableSkeleton rows={6} columns={5} label="Chargement de la liste" />
    </div>
  );
}

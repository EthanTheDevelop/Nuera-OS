import { KpiSkeleton, TableSkeleton, TileSkeleton } from "@/components/states/states";
import { KpiGrid } from "@/components/ui/kpi-card";

export default function FinancesLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="h-[60px]" />
      <KpiGrid>
        {Array.from({ length: 4 }, (_, index) => (
          <KpiSkeleton key={index} />
        ))}
      </KpiGrid>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-(--cols-main-side)">
        <div className="flex min-w-0 flex-col gap-6">
          <TableSkeleton rows={5} columns={5} label="Chargement des factures" />
          <TableSkeleton rows={3} columns={5} label="Chargement de la rentabilité" />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <TileSkeleton lines={3} label="Chargement de l'échéancier" />
          <TileSkeleton lines={3} label="Chargement des coûts récurrents" />
        </div>
      </div>
    </div>
  );
}

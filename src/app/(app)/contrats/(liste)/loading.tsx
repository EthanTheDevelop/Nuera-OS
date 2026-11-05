import { KpiSkeleton, TableSkeleton, TileSkeleton } from "@/components/states/states";
import { KpiGrid } from "@/components/ui/kpi-card";

/** Chargement de l'écran 20 : KPI, tableau, puis 728 + 20 + 380. */
export default function ContractsLoading() {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <KpiGrid>
        {Array.from({ length: 4 }, (_, index) => (
          <KpiSkeleton key={index} />
        ))}
      </KpiGrid>
      <TableSkeleton rows={4} columns={6} label="Chargement des contrats" />
      <div className="grid gap-5 xl:grid-cols-(--cols-main-side)">
        <TileSkeleton lines={2} label="Chargement des forfaits" />
        <TileSkeleton lines={2} label="Chargement des renouvellements" />
      </div>
    </div>
  );
}

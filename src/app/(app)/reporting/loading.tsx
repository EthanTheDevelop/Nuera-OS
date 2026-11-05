import { KpiSkeleton, TableSkeleton, TileSkeleton } from "@/components/states/states";
import { KpiGrid } from "@/components/ui/kpi-card";

export default function ReportingLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="h-[60px]" />
      <KpiGrid>
        {Array.from({ length: 4 }, (_, index) => (
          <KpiSkeleton key={index} />
        ))}
      </KpiGrid>
      <div className="grid grid-cols-1 items-start gap-5 min-[1340px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <TileSkeleton lines={4} className="min-h-[280px]" label="Chargement du graphique" />
          <TableSkeleton rows={5} columns={5} label="Chargement des activités" />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <TileSkeleton lines={4} label="Chargement des ventes" />
          <TileSkeleton lines={3} label="Chargement de la prévision" />
        </div>
      </div>
    </div>
  );
}

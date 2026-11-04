import { KpiSkeleton, TableSkeleton, TileSkeleton } from "@/components/states/states";
import { KpiGrid } from "@/components/ui/kpi-card";

/** Chargement de la fiche : mêmes emplacements, 728 + 20 + 380. */
export default function ContractLoading() {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <KpiGrid>
        {Array.from({ length: 4 }, (_, index) => (
          <KpiSkeleton key={index} />
        ))}
      </KpiGrid>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,728fr)_minmax(0,380fr)]">
        <div className="flex flex-col gap-5">
          <TileSkeleton lines={2} label="Chargement de la consommation" />
          <TableSkeleton rows={4} columns={3} label="Chargement du journal" />
        </div>
        <div className="flex flex-col gap-5">
          <TileSkeleton lines={3} label="Chargement de l'abonnement" />
          <TileSkeleton lines={2} label="Chargement des sites couverts" />
        </div>
      </div>
    </div>
  );
}

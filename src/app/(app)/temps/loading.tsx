import { KpiSkeleton, TableSkeleton, TileSkeleton } from "@/components/states/states";
import { KpiGrid } from "@/components/ui/kpi-card";

/** Arrivée de l'écran 18 : mêmes emplacements que la page, sans donnée. */
export default function TimeLoading() {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <div className="flex h-[62px] flex-col justify-center gap-2">
        <span className="anim-pulse block h-7 w-56 rounded-sm bg-surface-raised" />
        <span className="anim-pulse block h-3.5 w-80 max-w-full rounded-sm bg-surface-raised" />
      </div>
      <KpiGrid>
        {Array.from({ length: 4 }, (_, index) => (
          <KpiSkeleton key={index} />
        ))}
      </KpiGrid>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,728fr)_minmax(0,380fr)]">
        <div className="flex flex-col gap-(--grid-gap)">
          <TableSkeleton rows={5} columns={7} label="Chargement de la feuille de temps" />
          <TileSkeleton lines={1} label="Chargement de la capacité" />
        </div>
        <div className="flex flex-col gap-(--grid-gap)">
          <TileSkeleton lines={3} label="Chargement du simulateur" />
          <TileSkeleton lines={3} label="Chargement des catégories" />
        </div>
      </div>
    </div>
  );
}

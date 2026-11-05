import { TableSkeleton, TileSkeleton } from "@/components/states/states";

/** Chargement de l'écran 17 : mêmes emplacements que la fiche, 748 + 360. */
export default function ProjectLoading() {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <TileSkeleton lines={1} label="Chargement du projet" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <TableSkeleton rows={6} columns={5} label="Chargement des tâches" />
        <div className="flex flex-col gap-5">
          <TileSkeleton lines={2} label="Chargement du suivi" />
          <TileSkeleton lines={2} label="Chargement des blocages" />
        </div>
      </div>
    </div>
  );
}

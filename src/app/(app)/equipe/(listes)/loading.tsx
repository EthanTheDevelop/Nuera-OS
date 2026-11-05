import { TableSkeleton, TileSkeleton } from "@/components/states/states";

/** Arrivée de l'écran 22 : mêmes emplacements que la page, sans donnée. */
export default function TeamLoading() {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <div className="flex h-[62px] flex-col justify-center gap-2">
        <span className="anim-pulse block h-7 w-32 rounded-sm bg-surface-raised" />
        <span className="anim-pulse block h-3.5 w-80 max-w-full rounded-sm bg-surface-raised" />
      </div>
      <div className="grid gap-(--grid-gap) lg:grid-cols-2 2xl:grid-cols-(--cols-cards)">
        <TileSkeleton lines={2} label="Chargement des fiches" />
        <TileSkeleton lines={2} label="Chargement des fiches" />
      </div>
      <TableSkeleton rows={3} columns={5} label="Chargement des missions" />
      <TileSkeleton lines={2} label="Chargement des prestataires" />
    </div>
  );
}

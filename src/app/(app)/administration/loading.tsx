import { TableSkeleton, TileSkeleton } from "@/components/states/states";

/** Chargement de l'écran 24 : 728 + 20 + 380. */
export default function AdministrationLoading() {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-(--cols-main-side)">
      <div className="flex flex-col gap-5">
        <TableSkeleton rows={3} columns={4} label="Chargement des utilisateurs" />
        <TableSkeleton rows={5} columns={4} label="Chargement des permissions" />
      </div>
      <div className="flex flex-col gap-5">
        <TileSkeleton lines={4} label="Chargement des connexions" />
        <TileSkeleton lines={3} label="Chargement des exécutions" />
      </div>
    </div>
  );
}

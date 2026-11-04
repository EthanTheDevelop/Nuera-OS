import { TableSkeleton, TileSkeleton } from "@/components/states/states";

/** Même structure que l'écran 23 : tableau et deux cartes à gauche, deux cartes à droite. */
export default function DocumentsLoading() {
  return (
    <div className="grid grid-cols-1 gap-5 pt-[120px] xl:grid-cols-[minmax(0,728fr)_minmax(0,380fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <TableSkeleton rows={5} columns={5} label="Chargement des documents" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <TileSkeleton label="Chargement des modèles" />
          <TileSkeleton label="Chargement des checklists" />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <TileSkeleton lines={4} label="Chargement de la base de connaissances" />
        <TileSkeleton label="Chargement de l'historique" />
      </div>
    </div>
  );
}

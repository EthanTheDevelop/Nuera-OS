import { TableSkeleton } from "@/components/states/states";

/** Chargement de l'écran 03 : le titre reste en place, les colonnes arrivent après. */
export default function PipelineLoading() {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <h1 className="text-page-title text-ink">Pipeline</h1>
      <TableSkeleton rows={6} columns={6} rowHeight="lg" label="Chargement du pipeline" />
    </div>
  );
}

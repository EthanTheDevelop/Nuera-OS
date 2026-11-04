import { TableSkeleton, TileSkeleton } from "@/components/states/states";

/** Chargement de l'écran 08 : l'en-tête est dans le cadre, le tableau et la charge arrivent après. */
export default function ProjectsLoading() {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <h1 className="text-page-title text-ink">Projets</h1>
      <TableSkeleton rows={5} columns={6} rowHeight="lg" label="Chargement des projets" />
      <TileSkeleton lines={1} label="Chargement de la charge" />
    </div>
  );
}

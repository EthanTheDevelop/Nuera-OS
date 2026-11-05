import { TableSkeleton, TileSkeleton } from "@/components/states/states";

/** Chargement de l'écran 12 : cartes de règles, puis exécutions. */
export default function AutomationsLoading() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 4 }, (_, index) => (
        <TileSkeleton key={index} lines={1} label="Chargement des règles" />
      ))}
      <TableSkeleton rows={4} columns={4} label="Chargement des exécutions" />
    </div>
  );
}

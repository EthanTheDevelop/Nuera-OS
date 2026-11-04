import { TableSkeleton } from "@/components/states/states";

/** Chargement de l'écran 07 : le titre reste en place, le tableau arrive après. */
export default function ClientsLoading() {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <h1 className="text-page-title text-ink">Clients</h1>
      <TableSkeleton rows={8} columns={6} rowHeight="lg" label="Chargement des clients" />
    </div>
  );
}

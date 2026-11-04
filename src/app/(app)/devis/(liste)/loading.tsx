import { TableSkeleton, TileSkeleton } from "@/components/states/states";

export default function DevisLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="anim-pulse h-8 w-32 rounded-sm bg-surface-raised" />
        <div className="anim-pulse h-4 w-64 rounded-sm bg-surface-raised" />
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,668fr)_minmax(0,440fr)]">
        <TableSkeleton rows={5} columns={4} rowHeight="lg" label="Chargement des devis" />
        <TileSkeleton lines={6} label="Chargement du devis" className="min-h-[584px] rounded-lg" />
      </div>
    </div>
  );
}

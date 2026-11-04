import { TableSkeleton } from "@/components/states/states";

export default function CatalogueLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="anim-pulse h-8 w-40 rounded-sm bg-surface-raised" />
        <div className="anim-pulse h-4 w-72 rounded-sm bg-surface-raised" />
      </div>
      <TableSkeleton rows={6} columns={4} label="Chargement du catalogue" />
    </div>
  );
}

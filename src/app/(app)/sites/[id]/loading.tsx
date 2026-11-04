import { KpiSkeleton, TableSkeleton, TileSkeleton } from "@/components/states/states";
import { KpiGrid } from "@/components/ui/kpi-card";

export default function SiteLoading() {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <KpiGrid>
        {Array.from({ length: 4 }, (_, index) => (
          <KpiSkeleton key={index} />
        ))}
      </KpiGrid>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,728fr)_minmax(0,380fr)]">
        <TableSkeleton rows={5} />
        <TileSkeleton lines={4} />
      </div>
    </div>
  );
}

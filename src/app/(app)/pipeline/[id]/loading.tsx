import { TileSkeleton } from "@/components/states/states";

export default function OpportunityLoading() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-5">
        <TileSkeleton lines={3} label="Chargement de l'affaire" />
        <TileSkeleton lines={4} label="Chargement des échanges" />
      </div>
      <TileSkeleton lines={4} label="Chargement de la qualification" />
    </div>
  );
}

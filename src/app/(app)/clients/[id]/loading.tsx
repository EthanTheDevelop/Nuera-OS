import { TileSkeleton } from "@/components/states/states";

export default function ClientRecordLoading() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-5">
        <TileSkeleton lines={3} label="Chargement des affaires" />
        <TileSkeleton lines={5} label="Chargement de l'historique" />
      </div>
      <TileSkeleton lines={4} label="Chargement des contacts" />
    </div>
  );
}

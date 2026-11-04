import { TileSkeleton } from "@/components/states/states";

export default function ContactLoading() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <TileSkeleton lines={5} label="Chargement de l'historique" />
      <TileSkeleton lines={4} label="Chargement des coordonnées" />
    </div>
  );
}

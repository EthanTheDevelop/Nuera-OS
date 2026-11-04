import { TileSkeleton } from "@/components/states/states";

export default function DuplicatesLoading() {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <h1 className="text-page-title text-ink">Doublons</h1>
      <TileSkeleton lines={3} label="Recherche des doublons" />
    </div>
  );
}

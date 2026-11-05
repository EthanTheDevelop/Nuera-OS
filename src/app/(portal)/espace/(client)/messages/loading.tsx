import { TileSkeleton } from "@/components/states/states";

export default function PortalLoading() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,856fr)_minmax(0,480fr)]">
      <div className="flex flex-col gap-6">
        <TileSkeleton lines={3} label="Chargement de votre espace" />
        <TileSkeleton lines={4} label="Chargement de votre espace" />
      </div>
      <TileSkeleton lines={5} label="Chargement de votre espace" />
    </div>
  );
}

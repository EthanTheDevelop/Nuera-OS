import { TileSkeleton } from "@/components/states/states";

/** Chargement du calendrier : l'en-tête est dans le cadre, le mois arrive après. */
export default function ProjectsCalendarLoading() {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <h1 className="text-page-title text-ink">Calendrier des projets</h1>
      <TileSkeleton lines={6} label="Chargement du calendrier" />
    </div>
  );
}

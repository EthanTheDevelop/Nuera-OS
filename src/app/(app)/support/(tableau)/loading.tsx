import { TileSkeleton } from "@/components/states/states";
import { TICKET_STATUSES } from "@/lib/domain-enums";

/** Chargement de l'écran 11 : l'en-tête est dans le cadre, les colonnes arrivent après. */
export default function SupportLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title text-ink">Demandes et support</h1>
      </div>
      <div className="grid gap-(--grid-gap) sm:grid-cols-2 lg:grid-cols-5">
        {TICKET_STATUSES.map((status) => (
          <TileSkeleton key={status} lines={3} label="Chargement des demandes" />
        ))}
      </div>
    </div>
  );
}

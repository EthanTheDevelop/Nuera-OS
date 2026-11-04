import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/states/states";
import { Tile } from "@/components/ui/tile";
import { formatDateLong } from "@/lib/format";
import { requireInternalActor } from "@/server/auth/session";

export const metadata: Metadata = { title: "Tableau de bord" };

/** Point de départ du lot Pilotage, qui en reprendra le contenu (écrans 01, 06, M1). */
export default async function HomePage() {
  const actor = await requireInternalActor();
  const firstName = actor.name.trim().split(/\s+/)[0] ?? actor.name;
  const date = formatDateLong(new Date());
  const today = date.charAt(0).toLocaleUpperCase("fr-FR") + date.slice(1);

  return (
    <>
      <PageHeader title={`Bonjour ${firstName}`} subtitle={`${today} · l’agence aujourd’hui`} />
      <Tile className="rounded-lg">
        <EmptyState
          icon="dashboard"
          title="Le tableau de bord arrive"
          description="Les tuiles de pilotage s’afficheront ici dès que les modules métier seront en service."
        />
      </Tile>
    </>
  );
}

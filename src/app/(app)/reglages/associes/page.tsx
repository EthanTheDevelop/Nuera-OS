import { EmptyState, ForbiddenState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";
import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { listAssignableMembers, type MemberOption } from "@/modules/team/team.lookup";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

const columns: readonly DataTableColumn<MemberOption>[] = [
  {
    key: "nom",
    header: "Personne",
    primary: true,
    cell: (row) => <CellIdentity name={row.fullName} title={row.fullName} />,
  },
  { key: "titre", header: "Fonction", cell: (row) => row.title ?? "Non renseignée" },
];

/** Onglet Associés, non dessiné : la source reste le module Équipe, aucune donnée en double. */
export default async function PartnersSettingsPage() {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "team:read")) return <ForbiddenState />;
  const partners = (await listAssignableMembers(ctx.db)).filter(
    (member) => member.kind === "partner",
  );
  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption="Direction de l'agence"
        columns={columns}
        rows={partners}
        rowKey={(row) => row.id}
        rowHref={(row) => `/equipe/${row.id}`}
        rowHeight="md"
        empty={
          <EmptyState
            compact
            icon="equipe"
            title="Aucune fiche de direction"
            description="Créez la fiche depuis le module Équipe."
          />
        }
      />
      <div>
        <ButtonLink href="/equipe">Ouvrir l&apos;équipe</ButtonLink>
      </div>
    </div>
  );
}

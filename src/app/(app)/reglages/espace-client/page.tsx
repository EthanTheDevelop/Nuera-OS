import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { InfoCard } from "@/components/ui/info-card";
import { formatDateTime } from "@/lib/format";
import { listUsers } from "@/modules/admin/admin.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

type ClientRow = Awaited<ReturnType<typeof listUsers>>["items"][number];

const columns: readonly DataTableColumn<ClientRow>[] = [
  {
    key: "compte",
    header: "Compte client",
    primary: true,
    cell: (row) => <CellIdentity name={row.name} title={row.name} subtitle={row.email} />,
  },
  {
    key: "etat",
    header: "État",
    width: 130,
    cell: (row) =>
      row.banned ? <Badge tone="neutral">Désactivé</Badge> : <Badge tone="success">Actif</Badge>,
  },
  {
    key: "connexion",
    header: "Dernière connexion",
    width: 170,
    cell: (row) => (row.lastSignInAt ? formatDateTime(row.lastSignInAt) : "Jamais"),
  },
];

/** Onglet Espace client, non dessiné : comptes du portail. Les invitations partent de la fiche client. */
export default async function PortalSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "integrations:read")) return <ForbiddenState />;
  if (!can(ctx.actor, "admin:read")) {
    return (
      <ForbiddenState description="La liste des comptes clients est réservée à la direction." />
    );
  }
  const params = await searchParams;
  const clients = await listUsers(ctx, { role: "client", page: params.page, pageSize: 25 });
  return (
    <div className="flex flex-col gap-6">
      <InfoCard icon="clients" title="Comment un client se connecte">
        <p className="text-sm text-text">
          Par un lien reçu par e-mail, valable 24 heures, sans mot de passe. L&apos;invitation se
          fait depuis la fiche du client, et chaque compte ne voit que les données de sa société.
        </p>
      </InfoCard>
      <DataTable
        caption="Comptes de l'espace client"
        columns={columns}
        rows={clients.items}
        rowKey={(row) => row.id}
        rowHeight="md"
        query={{ pathname: "/reglages/espace-client", searchParams: {} }}
        pagination={{ page: clients.page, pageSize: clients.pageSize, total: clients.total }}
        empty={
          <EmptyState
            compact
            icon="clients"
            title="Aucun compte client"
            description="Invitez un contact depuis la fiche de son client."
          />
        }
      />
    </div>
  );
}

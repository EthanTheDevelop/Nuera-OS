import { EmptyState, ForbiddenState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { formatDateShort } from "@/lib/format";
import type { TemplateRow } from "@/modules/documents/document.types";
import { listTemplates } from "@/modules/documents/template.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

const columns: readonly DataTableColumn<TemplateRow>[] = [
  {
    key: "modele",
    header: "Modèle",
    primary: true,
    cell: (row) => <span className="block text-cell font-semibold text-ink">{row.name}</span>,
  },
  { key: "modifie", header: "Modifié", width: 120, cell: (row) => formatDateShort(row.updatedAt) },
];

/** Onglet Modèles de messages, non dessiné : ils se gèrent dans Documents, ici leur liste. */
export default async function MessageTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "knowledge:read")) return <ForbiddenState />;
  const params = await searchParams;
  const templates = await listTemplates(
    ctx,
    { kinds: ["message"], active: true },
    parsePagination({ page: params.page, pageSize: 25 }),
  );
  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption="Modèles de messages"
        columns={columns}
        rows={templates.items}
        rowKey={(row) => row.id}
        rowHref={(row) => `/documents/modeles/${row.id}`}
        rowHeight="md"
        query={{ pathname: "/reglages/modeles", searchParams: {} }}
        pagination={{ page: templates.page, pageSize: templates.pageSize, total: templates.total }}
        empty={
          <EmptyState
            compact
            icon="messages"
            title="Aucun modèle de message"
            description="Créez le premier dans Documents, onglet Modèles."
          />
        }
      />
      <div>
        <ButtonLink href="/documents/modeles?type=message">Gérer les modèles</ButtonLink>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { FINANCIAL_DOCUMENT_SOURCE_LABELS } from "@/lib/domain-enums";
import { formatDateTime } from "@/lib/format";
import { paramValue } from "@/lib/url-state";
import { FinanceForbidden } from "@/modules/finance/components/finance-forbidden";
import { listImportHistory } from "@/modules/finance/import.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Imports de factures" };

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "finance:read")) return <FinanceForbidden />;

  const params = await searchParams;
  const page = await listImportHistory(ctx, parsePagination({ page: paramValue(params, "page") }));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Finances", href: "/finances" }, { label: "Imports" }]}
        title="Imports de factures"
        subtitle={`${page.total} import${page.total > 1 ? "s" : ""} · chaque ligne refusée garde son motif`}
      />
      <DataTable
        caption="Historique des imports"
        rows={page.items}
        rowKey={(row) => row.id}
        rowHref={(row) => `/finances/imports/${row.id}`}
        query={{ pathname: "/finances/imports", searchParams: params }}
        pagination={page}
        empty={
          <EmptyState
            compact
            icon="download"
            title="Aucun import"
            description="Lancez un import depuis l'écran Finances, avec le bouton « Importer un CSV »."
          />
        }
        columns={[
          {
            key: "file",
            header: "Fichier",
            primary: true,
            cell: (row) => (
              <span className="block truncate text-row-primary text-ink">
                {row.filename ?? FINANCIAL_DOCUMENT_SOURCE_LABELS[row.source]}
              </span>
            ),
          },
          {
            key: "at",
            header: "Date",
            width: 170,
            cell: (row) => <span className="tabular">{formatDateTime(row.at)}</span>,
          },
          {
            key: "total",
            header: "Lignes",
            width: 80,
            cell: (row) => <span className="tabular">{row.rowsTotal}</span>,
          },
          {
            key: "created",
            header: "Créées",
            width: 80,
            cell: (row) => <span className="tabular">{row.rowsCreated}</span>,
          },
          {
            key: "updated",
            header: "Mises à jour",
            width: 110,
            cell: (row) => <span className="tabular">{row.rowsUpdated}</span>,
          },
          {
            key: "rejected",
            header: "Refusées",
            width: 100,
            cell: (row) =>
              row.rowsRejected > 0 ? (
                <Badge tone="danger">{row.rowsRejected}</Badge>
              ) : (
                <span className="tabular">0</span>
              ),
          },
        ]}
      />
    </>
  );
}

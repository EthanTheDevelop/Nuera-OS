import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/states/states";
import { StatusBadge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { formatDateNumeric } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { paramValue } from "@/lib/url-state";
import { NewScheduleButton } from "@/modules/finance/components/finance-actions";
import { FinanceForbidden } from "@/modules/finance/components/finance-forbidden";
import { getFinanceFormOptions, listSchedule } from "@/modules/finance/finance.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Échéancier" };

const STATUSES = new Set(["planned", "invoiced", "paid"]);

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "finance:read")) return <FinanceForbidden />;

  const params = await searchParams;
  const statusParam = paramValue(params, "etat");
  const status = statusParam && STATUSES.has(statusParam) ? statusParam : null;
  const search = paramValue(params, "q") ?? null;
  const [page, options] = await Promise.all([
    listSchedule(ctx, { status, search }, parsePagination({ page: paramValue(params, "page") })),
    getFinanceFormOptions(ctx),
  ]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Finances", href: "/finances" }, { label: "Échéancier" }]}
        title="Échéancier"
        subtitle={`${page.total} échéance${page.total > 1 ? "s" : ""} · acomptes et paiements prévus, une facture par associé en co-traitance`}
        actions={can(ctx.actor, "finance:manage") ? <NewScheduleButton options={options} /> : null}
      >
        <FilterBar
          searchParam="q"
          searchPlaceholder="Échéance, client, projet…"
          label="Filtrer par état"
        >
          <FilterChip param="etat">Toutes</FilterChip>
          <FilterChip param="etat" value="planned">
            Prévues
          </FilterChip>
          <FilterChip param="etat" value="invoiced">
            Facturées
          </FilterChip>
          <FilterChip param="etat" value="paid">
            Payées
          </FilterChip>
        </FilterBar>
      </PageHeader>

      <DataTable
        caption="Échéances"
        rows={page.items}
        rowKey={(row) => row.id}
        rowHref={(row) => `/finances/echeancier/${row.id}`}
        query={{ pathname: "/finances/echeancier", searchParams: params }}
        pagination={page}
        empty={
          <EmptyState
            compact
            icon="clock"
            title={status || search ? "Aucune échéance pour ce filtre" : "Aucune échéance"}
            description="Ajoutez les acomptes et soldes prévus : ils alimentent les entrées d'argent à venir."
          />
        }
        columns={[
          {
            key: "label",
            header: "Échéance",
            primary: true,
            cell: (row) => (
              <span className="block truncate text-row-primary text-ink">{row.label}</span>
            ),
          },
          {
            key: "client",
            header: "Client · objet",
            cell: (row) => (
              <span className="block truncate">
                {[
                  row.companyName,
                  (row.projectName ?? row.contractName ?? "")
                    .replace(row.companyName, "")
                    .replace(/^\s*[·\-–—:]\s*/, "")
                    .trim() || null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ),
          },
          {
            key: "date",
            header: "Date",
            width: 110,
            cell: (row) => <span className="tabular">{formatDateNumeric(row.dueOn)}</span>,
          },
          {
            key: "amount",
            header: "Montant",
            width: 110,
            cell: (row) => <span className="tabular">{formatCents(row.amountCents)}</span>,
          },
          {
            key: "invoiced",
            header: "Facturé",
            width: 130,
            cell: (row) => (
              <span className="tabular">
                {formatCents(row.invoicedCents)}
                {row.documentCount > 0
                  ? ` · ${row.documentCount} facture${row.documentCount > 1 ? "s" : ""}`
                  : ""}
              </span>
            ),
          },
          {
            key: "status",
            header: "État",
            width: 110,
            cell: (row) => <StatusBadge kind="schedule" status={row.status} />,
          },
        ]}
      />
    </>
  );
}

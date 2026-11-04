import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { paramValue } from "@/lib/url-state";
import { ExportMenu } from "@/modules/finance/components/finance-actions";
import { FinanceForbidden } from "@/modules/finance/components/finance-forbidden";
import { MarginTable } from "@/modules/finance/components/margin-table";
import { isMarginScope, MARGIN_SCOPE_LABELS } from "@/modules/finance/finance.constants";
import { listProfitability, type MarginScope } from "@/modules/finance/profitability.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Rentabilité" };

const FIRST_HEADERS: Record<MarginScope, string> = {
  project: "Projet",
  client: "Client",
  site: "Site",
  contract: "Contrat",
};

export default async function ProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "finance:read")) return <FinanceForbidden />;

  const params = await searchParams;
  const view = paramValue(params, "vue");
  const scope: MarginScope = isMarginScope(view) ? view : "project";
  const search = paramValue(params, "q") ?? null;
  const page = await listProfitability(
    ctx,
    scope,
    search,
    parsePagination({ page: paramValue(params, "page") }),
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Finances", href: "/finances" }, { label: "Rentabilité" }]}
        title="Rentabilité"
        subtitle={`${page.total} ${MARGIN_SCOPE_LABELS[scope].toLocaleLowerCase("fr-FR")} · marge HT = revenus attribués − coûts attribués, temps compris`}
        actions={can(ctx.actor, "export:run") ? <ExportMenu /> : null}
      >
        <FilterBar searchParam="q" searchPlaceholder="Rechercher…" label="Portée de la rentabilité">
          <FilterChip param="vue">{MARGIN_SCOPE_LABELS.project}</FilterChip>
          <FilterChip param="vue" value="client">
            {MARGIN_SCOPE_LABELS.client}
          </FilterChip>
          <FilterChip param="vue" value="site">
            {MARGIN_SCOPE_LABELS.site}
          </FilterChip>
          <FilterChip param="vue" value="contract">
            {MARGIN_SCOPE_LABELS.contract}
          </FilterChip>
        </FilterBar>
      </PageHeader>
      <MarginTable
        rows={page.items}
        scope={scope}
        firstHeader={FIRST_HEADERS[scope]}
        caption={`Rentabilité par ${FIRST_HEADERS[scope].toLocaleLowerCase("fr-FR")}`}
        query={{ pathname: "/finances/rentabilite", searchParams: params }}
        pagination={page}
      />
    </>
  );
}

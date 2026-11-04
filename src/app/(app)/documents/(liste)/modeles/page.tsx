import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import {
  OFFER_ACTIVITY_LABELS,
  TEMPLATE_KIND_LABELS,
  TEMPLATE_KINDS,
  type TemplateKind,
} from "@/lib/domain-enums";
import { formatDateShort } from "@/lib/format";
import { hrefWith } from "@/lib/url-state";
import { ActiveFilter } from "@/modules/documents/components/active-filter";
import { AddTemplateButton } from "@/modules/documents/components/documents-actions";
import { formatTemplateCount } from "@/modules/documents/document.format";
import type { TemplateRow } from "@/modules/documents/document.types";
import { listTemplates } from "@/modules/documents/template.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const isKind = (value: string | undefined): value is TemplateKind =>
  TEMPLATE_KINDS.includes(value as TemplateKind);

const columns: readonly DataTableColumn<TemplateRow>[] = [
  {
    key: "modele",
    header: "Modèle",
    primary: true,
    cell: (row) => <span className="block text-cell font-semibold text-ink">{row.name}</span>,
  },
  { key: "type", header: "Type", width: 160, cell: (row) => TEMPLATE_KIND_LABELS[row.kind] },
  {
    key: "prestation",
    header: "Prestation",
    width: 200,
    cell: (row) => (row.activity ? OFFER_ACTIVITY_LABELS[row.activity] : "Toutes"),
  },
  { key: "modifie", header: "Modifié", width: 110, cell: (row) => formatDateShort(row.updatedAt) },
];

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "knowledge:read")) return <ForbiddenState />;

  const params = await searchParams;
  const search = one(params.q)?.trim() || undefined;
  const type = one(params.type);
  const inactive = one(params.inactifs) === "1";

  const templates = await listTemplates(
    ctx,
    { search, kinds: isKind(type) ? [type] : undefined, active: !inactive },
    parsePagination({ page: one(params.page), pageSize: 25 }),
  );

  return (
    <>
      <PageHeader
        title="Modèles"
        subtitle={`${formatTemplateCount(templates.total)}${inactive ? " désactivés" : ""} · briefs, checklists, messages et plans de projet`}
        breadcrumbs={[{ label: "Documents", href: "/documents" }, { label: "Modèles" }]}
        actions={can(ctx.actor, "knowledge:manage") ? <AddTemplateButton /> : undefined}
      >
        <FilterBar searchParam="q" searchPlaceholder="Rechercher un modèle…" label="Type de modèle">
          <FilterChip param="type">Tous</FilterChip>
          {TEMPLATE_KINDS.map((kind) => (
            <FilterChip key={kind} param="type" value={kind}>
              {TEMPLATE_KIND_LABELS[kind]}
            </FilterChip>
          ))}
          {inactive ? (
            <ActiveFilter
              href={hrefWith("/documents/modeles", params, { inactifs: null, page: null })}
            >
              Désactivés
            </ActiveFilter>
          ) : (
            <FilterChip param="inactifs" value="1">
              Désactivés
            </FilterChip>
          )}
        </FilterBar>
      </PageHeader>

      <DataTable
        caption="Modèles"
        columns={columns}
        rows={templates.items}
        rowKey={(row) => row.id}
        rowHref={(row) => `/documents/modeles/${row.id}`}
        query={{ pathname: "/documents/modeles", searchParams: params }}
        pagination={
          templates.total > templates.pageSize
            ? { page: templates.page, pageSize: templates.pageSize, total: templates.total }
            : undefined
        }
        empty={
          <EmptyState
            compact
            icon="edit"
            title="Aucun modèle trouvé"
            description="Créez un brief, une checklist, un message ou un plan de projet réutilisable."
          />
        }
      />
    </>
  );
}

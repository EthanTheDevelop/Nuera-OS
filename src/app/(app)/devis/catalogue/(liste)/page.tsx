import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import {
  CATALOG_ITEM_KIND_LABELS,
  CATALOG_ITEM_KINDS,
  OFFER_ACTIVITY_LABELS,
  type CatalogItemKind,
} from "@/lib/domain-enums";
import { formatDays, formatPercent } from "@/lib/format";
import { formatCents, marginPercent } from "@/lib/money";
import { paramValue } from "@/lib/url-state";
import { NewCatalogItemButton } from "@/modules/catalog/components/catalog-controls";
import {
  canSeeCatalogCosts,
  listCatalogItems,
  type CatalogItem,
} from "@/modules/catalog/catalog.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Catalogue" };

/** Colonnes de coût : retirées pour qui ne les voit pas. */
const COST_COLUMNS = new Set(["cout", "marge"]);

const COLUMNS: DataTableColumn<CatalogItem>[] = [
  {
    key: "nom",
    header: "Prestation",
    primary: true,
    cell: (item) => (
      <CellIdentity
        title={item.name}
        subtitle={`${CATALOG_ITEM_KIND_LABELS[item.kind]} · ${OFFER_ACTIVITY_LABELS[item.activity]}`}
      />
    ),
  },
  {
    key: "prix",
    header: "Prix HT",
    width: 110,
    align: "right",
    cell: (item) => <span className="tabular text-ink">{formatCents(item.priceCents)}</span>,
  },
  {
    key: "cout",
    header: "Coût estimé",
    width: 110,
    align: "right",
    hideWhenCollapsed: true,
    cell: (item) => <span className="tabular">{formatCents(item.estimatedCostCents)}</span>,
  },
  {
    key: "temps",
    header: "Temps",
    width: 90,
    align: "right",
    hideWhenCollapsed: true,
    cell: (item) => (
      <span className="tabular">
        {item.estimatedMinutes >= 21 ? formatDays(item.estimatedMinutes) : "—"}
      </span>
    ),
  },
  {
    key: "marge",
    header: "Marge",
    width: 90,
    align: "right",
    hideWhenCollapsed: true,
    cell: (item) => (
      <span className="tabular">
        {formatPercent(marginPercent(item.priceCents, item.estimatedCostCents))}
      </span>
    ),
  },
  {
    key: "etat",
    header: "État",
    width: 120,
    cell: (item) => (item.active ? <Badge tone="success">En vente</Badge> : <Badge>Retirée</Badge>),
  },
];

function parseKind(value: string | undefined): CatalogItemKind | undefined {
  return CATALOG_ITEM_KINDS.find((kind) => kind === value);
}

/** Catalogue des prestations, formules et options (domaine 04.01, non dessiné dans Figma). */
export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "catalog:read")) {
    return (
      <>
        <PageHeader title="Catalogue" />
        <ForbiddenState />
      </>
    );
  }

  const search = paramValue(params, "q");
  const kind = parseKind(paramValue(params, "type"));
  const stateParam = paramValue(params, "etat");
  const state = stateParam === "retirees" ? "inactive" : "active";
  const { items, total, page, pageSize } = await listCatalogItems(ctx, {
    search,
    kind,
    state,
    page: paramValue(params, "page"),
  });
  const canManage = can(ctx.actor, "catalog:manage");

  return (
    <>
      <PageHeader
        title="Catalogue"
        subtitle={`${total} ${total > 1 ? "prestations" : "prestation"} ${
          state === "active"
            ? "en vente"
            : total > 1
              ? "retirées de la vente"
              : "retirée de la vente"
        } · ${
          canSeeCatalogCosts(ctx.actor) ? "prix, coûts et conditions" : "prix et conditions"
        } repris dans les devis`}
        breadcrumbs={[{ label: "Devis", href: "/devis" }, { label: "Catalogue" }]}
        actions={canManage ? <NewCatalogItemButton /> : undefined}
      >
        <FilterBar searchParam="q" label="Filtrer le catalogue">
          <FilterChip param="type">Toutes</FilterChip>
          {CATALOG_ITEM_KINDS.map((value) => (
            <FilterChip key={value} param="type" value={value}>
              {CATALOG_ITEM_KIND_LABELS[value]}
            </FilterChip>
          ))}
          <FilterChip param="etat" value="retirees">
            Retirées
          </FilterChip>
        </FilterBar>
      </PageHeader>
      <DataTable
        caption="Catalogue des prestations"
        columns={
          canSeeCatalogCosts(ctx.actor)
            ? COLUMNS
            : COLUMNS.filter((column) => !COST_COLUMNS.has(column.key))
        }
        rows={items}
        rowKey={(item) => item.id}
        rowHref={(item) => `/devis/catalogue/${item.id}`}
        query={{ pathname: "/devis/catalogue", searchParams: params }}
        pagination={total > pageSize ? { page, pageSize, total } : undefined}
        empty={
          <EmptyState
            icon="book"
            title="Aucune prestation ici"
            description={
              canManage
                ? "Ajoutez une prestation pour composer vos devis plus vite."
                : "Un associé peut compléter le catalogue."
            }
            action={canManage ? <NewCatalogItemButton /> : undefined}
          />
        }
      />
    </>
  );
}

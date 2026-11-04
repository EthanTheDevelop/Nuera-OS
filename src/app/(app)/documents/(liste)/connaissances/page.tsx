import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { KNOWLEDGE_KIND_LABELS, KNOWLEDGE_KINDS, type KnowledgeKind } from "@/lib/domain-enums";
import { formatDateShort } from "@/lib/format";
import { hrefWith } from "@/lib/url-state";
import { ActiveFilter } from "@/modules/documents/components/active-filter";
import { AddArticleButton } from "@/modules/documents/components/documents-actions";
import { firstName, formatArticleCount } from "@/modules/documents/document.format";
import type { ArticleRow } from "@/modules/documents/document.types";
import { listKnowledgeArticles } from "@/modules/documents/knowledge.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidParam = (value: string | string[] | undefined) => {
  const text = one(value);
  return text && UUID.test(text) ? text : undefined;
};

const isKind = (value: string | undefined): value is KnowledgeKind =>
  KNOWLEDGE_KINDS.includes(value as KnowledgeKind);

const columns: readonly DataTableColumn<ArticleRow>[] = [
  {
    key: "article",
    header: "Article",
    primary: true,
    cell: (row) => <span className="block text-cell font-semibold text-ink">{row.title}</span>,
  },
  {
    key: "type",
    header: "Type",
    width: 200,
    cell: (row) => KNOWLEDGE_KIND_LABELS[row.kind],
  },
  {
    key: "lien",
    header: "Lié à",
    width: 200,
    cell: (row) =>
      row.projectNumber
        ? `Projet ${row.projectNumber}`
        : row.siteName
          ? `Site · ${row.siteName}`
          : "Agence",
  },
  { key: "version", header: "Version", width: 90, cell: (row) => `v${row.version}` },
  { key: "auteur", header: "Auteur", width: 120, cell: (row) => firstName(row.authorName) },
  { key: "modifie", header: "Modifié", width: 110, cell: (row) => formatDateShort(row.updatedAt) },
];

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "knowledge:read")) return <ForbiddenState />;

  const params = await searchParams;
  const search = one(params.q)?.trim() || undefined;
  const type = one(params.type);
  const archived = one(params.archives) === "1";
  // Posés par un lien depuis la fiche d'un site ou d'un projet (« Procédure de restauration »).
  const siteId = uuidParam(params.site);
  const projectId = uuidParam(params.projet);

  const articles = await listKnowledgeArticles(
    ctx,
    { search, kind: isKind(type) ? type : undefined, siteId, projectId, archived },
    parsePagination({ page: one(params.page), pageSize: 25 }),
  );

  const without = (param: string) =>
    hrefWith("/documents/connaissances", params, { [param]: null, page: null });

  const summary = archived
    ? `${formatArticleCount(articles.total)} archivés`
    : `${formatArticleCount(articles.total)} · procédures, documentation technique, problèmes fréquents`;

  return (
    <>
      <PageHeader
        title="Base de connaissances"
        subtitle={summary}
        breadcrumbs={[{ label: "Documents", href: "/documents" }, { label: "Connaissances" }]}
        actions={can(ctx.actor, "knowledge:manage") ? <AddArticleButton prominent /> : undefined}
      >
        <FilterBar
          searchParam="q"
          searchPlaceholder="Rechercher un article…"
          label="Type d'article"
        >
          <FilterChip param="type">Tous</FilterChip>
          {KNOWLEDGE_KINDS.map((kind) => (
            <FilterChip key={kind} param="type" value={kind}>
              {KNOWLEDGE_KIND_LABELS[kind]}
            </FilterChip>
          ))}
          {archived ? (
            <ActiveFilter href={without("archives")}>Archivés</ActiveFilter>
          ) : (
            <FilterChip param="archives" value="1">
              Archivés
            </FilterChip>
          )}
          {siteId ? (
            <ActiveFilter href={without("site")}>
              {articles.items[0]?.siteName ? `Site · ${articles.items[0].siteName}` : "Ce site"}
            </ActiveFilter>
          ) : null}
          {projectId ? (
            <ActiveFilter href={without("projet")}>
              {articles.items[0]?.projectNumber
                ? `Projet ${articles.items[0].projectNumber}`
                : "Ce projet"}
            </ActiveFilter>
          ) : null}
        </FilterBar>
      </PageHeader>

      <DataTable
        caption="Articles de la base de connaissances"
        columns={columns}
        rows={articles.items}
        rowKey={(row) => row.id}
        rowHref={(row) => `/documents/connaissances/${row.id}`}
        query={{ pathname: "/documents/connaissances", searchParams: params }}
        pagination={
          articles.total > articles.pageSize || articles.items.length === 0
            ? { page: articles.page, pageSize: articles.pageSize, total: articles.total }
            : undefined
        }
        empty={
          <EmptyState
            compact
            icon="book"
            title={
              search || type || archived || siteId || projectId || articles.total > 0
                ? "Aucun article trouvé"
                : "Aucun article"
            }
            description={
              search || type || archived || siteId || projectId || articles.total > 0
                ? "Essayez un autre terme, un autre type ou retirez le filtre."
                : "La base de connaissances attend son premier article."
            }
          />
        }
      />
    </>
  );
}

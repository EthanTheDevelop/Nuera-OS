import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { staggerIndex } from "@/components/motion/stagger";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { StatusBadge } from "@/components/ui/badge";
import { CompactLink } from "@/components/ui/compact-button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FilterBar, FilterChip, SearchField } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { InfoCard, InfoRows } from "@/components/ui/info-card";
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  DOCUMENT_VISIBILITIES,
  DOCUMENT_VISIBILITY_LABELS,
  KNOWLEDGE_KIND_LABELS,
  type DocumentKind,
  type DocumentVisibility,
} from "@/lib/domain-enums";
import { formatDateShort } from "@/lib/format";
import { hrefWith, type SearchParamsLike } from "@/lib/url-state";
import { ActiveFilter } from "@/modules/documents/components/active-filter";
import {
  AddArticleButton,
  DocumentsHeaderActions,
} from "@/modules/documents/components/documents-actions";
import {
  COMMERCIAL_DOCUMENT_KINDS,
  documentLinkLabel,
  documentVersionLabel,
  firstName,
  formatArticleCount,
  formatDocumentCount,
  formatTemplateCount,
} from "@/modules/documents/document.format";
import {
  getDocumentStorageStatus,
  listDocumentCompanyOptions,
  listDocumentVersions,
  searchDocuments,
} from "@/modules/documents/document.service";
import type {
  ArticleRow,
  DocumentRow,
  DocumentVersionRow,
  TemplateRow,
} from "@/modules/documents/document.types";
import { listKnowledgeArticles } from "@/modules/documents/knowledge.service";
import { listTemplates } from "@/modules/documents/template.service";
import { can, canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

const PAGE_SIZE = 10;
const CARD_ROWS = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const uuidParam = (value: string | string[] | undefined) => {
  const text = one(value);
  return text && UUID.test(text) ? text : undefined;
};

const isKind = (value: string | undefined): value is DocumentKind =>
  DOCUMENT_KINDS.includes(value as DocumentKind);
const isVisibility = (value: string | undefined): value is DocumentVisibility =>
  DOCUMENT_VISIBILITIES.includes(value as DocumentVisibility);

/**
 * Colonnes Figma 154, 150, 90, 120, 110 avec un écart de 16 : la grille du composant répartit ce
 * même écart en marges de cellule, d'où ces largeurs.
 */
const columns: readonly DataTableColumn<DocumentRow>[] = [
  {
    key: "document",
    header: "Document",
    width: 182,
    primary: true,
    cell: (row) => <span className="block text-cell font-semibold text-ink">{row.title}</span>,
  },
  { key: "lien", header: "Lié à", width: 166, cell: (row) => documentLinkLabel(row) },
  { key: "version", header: "Version", width: 106, cell: (row) => documentVersionLabel(row) },
  {
    key: "partage",
    header: "Partage",
    width: 136,
    cell: (row) => <StatusBadge kind="document" status={row.visibility} />,
  },
  { key: "modifie", header: "Modifié", width: 110, cell: (row) => formatDateShort(row.updatedAt) },
];

/** Filtre de contexte, posé par un lien depuis une fiche client, projet, contrat, site ou demande. */
const CONTEXT_FILTERS = [
  {
    param: "client",
    field: "companyId",
    label: (row?: DocumentRow) => `Client · ${row?.companyName ?? "sélectionné"}`,
  },
  {
    param: "projet",
    field: "projectId",
    label: (row?: DocumentRow) => `Projet ${row?.projectNumber ?? "sélectionné"}`,
  },
  {
    param: "contrat",
    field: "contractId",
    label: (row?: DocumentRow) => `Contrat ${row?.contractNumber ?? "sélectionné"}`,
  },
  {
    param: "site",
    field: "siteId",
    label: (row?: DocumentRow) => `Site · ${row?.siteName ?? "sélectionné"}`,
  },
  {
    param: "demande",
    field: "ticketId",
    label: (row?: DocumentRow) => `Demande ${row?.ticketNumber ?? "sélectionnée"}`,
  },
] as const;

/** Lien d'en-tête de carte : 36 de haut dans un en-tête de 28, sans le faire grandir. */
function CardLink({ href }: { href: string }) {
  return (
    <span className="-my-1 block">
      <CompactLink variant="quiet" href={href}>
        Tout voir
      </CompactLink>
    </span>
  );
}

function TemplateList({
  items,
  empty,
}: {
  items: readonly TemplateRow[];
  empty: { title: string; description: string };
}) {
  if (items.length === 0) {
    return <EmptyState compact icon="edit" title={empty.title} description={empty.description} />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {items.map((template) => (
        <li key={template.id}>
          <Link
            href={`/documents/modeles/${template.id}`}
            className="flex items-center gap-1.5 rounded-sm text-cell text-text hover:text-accent"
          >
            <Icon name="devis" size={16} className="shrink-0 text-accent" />
            <span className="min-w-0 truncate">{template.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ArticleList({ items }: { items: readonly ArticleRow[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon="book"
        title="Aucun article"
        description="Procédures, documentation technique et problèmes fréquents arrivent ici."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-5">
      {items.map((article) => (
        <li key={article.id}>
          <Link
            href={`/documents/connaissances/${article.id}`}
            className="block rounded-sm hover:[&>span:first-child]:text-accent"
          >
            <span className="block text-cell font-semibold text-ink">{article.title}</span>
            <span className="mt-0.5 block text-row-secondary text-muted">
              {KNOWLEDGE_KIND_LABELS[article.kind]}
              {article.authorName ? ` · ${firstName(article.authorName)}` : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function historyRows(versions: readonly DocumentVersionRow[], current: DocumentRow) {
  return versions.map((version) => ({
    key: version.id,
    label:
      version.id === current.currentVersionId && versions.length > 1
        ? `v${version.version} · référence`
        : `v${version.version}`,
    value: `${formatDateShort(version.createdAt)} · ${firstName(version.authorName)}`,
  }));
}

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!canAny(ctx.actor, ["documents:read", "documents:read_assigned"])) {
    return <ForbiddenState />;
  }

  const params = await searchParams;
  const search = one(params.q)?.trim() || undefined;
  const archived = one(params.archives) === "1";
  const kindParam = one(params.type);
  const visibilityParam = one(params.partage);
  const kind = isKind(kindParam) ? kindParam : undefined;
  const visibility = isVisibility(visibilityParam) ? visibilityParam : undefined;
  const context = {
    companyId: uuidParam(params.client),
    projectId: uuidParam(params.projet),
    contractId: uuidParam(params.contrat),
    siteId: uuidParam(params.site),
    ticketId: uuidParam(params.demande),
  };

  const canReadKnowledge = can(ctx.actor, "knowledge:read");
  const canManageKnowledge = can(ctx.actor, "knowledge:manage");
  const canCreateDocument = can(ctx.actor, "documents:create");
  const canSeeArchives = can(ctx.actor, "documents:read");

  const emptyPage = { items: [], total: 0, page: 1, pageSize: CARD_ROWS };
  const [documents, templates, checklists, articles, companies] = await Promise.all([
    searchDocuments(
      ctx,
      { ...context, search, archived, kind, visibility },
      parsePagination({ page: one(params.page), pageSize: PAGE_SIZE }),
    ),
    canReadKnowledge
      ? listTemplates(
          ctx,
          { search, kinds: ["brief", "message", "project_plan"] },
          { pageSize: CARD_ROWS },
        )
      : emptyPage,
    canReadKnowledge
      ? listTemplates(ctx, { search, kinds: ["checklist"] }, { pageSize: CARD_ROWS })
      : emptyPage,
    canReadKnowledge ? listKnowledgeArticles(ctx, { search }, { pageSize: CARD_ROWS }) : emptyPage,
    canCreateDocument ? listDocumentCompanyOptions(ctx) : [],
  ]);

  const latest = documents.items[0];
  const history = latest ? await listDocumentVersions(ctx, latest.id) : [];
  const storage = getDocumentStorageStatus();

  const subtitle = [
    formatDocumentCount(documents.total),
    ...(canReadKnowledge
      ? [
          formatTemplateCount(templates.total + checklists.total),
          formatArticleCount(articles.total),
        ]
      : []),
    "recherche par client, projet ou contrat",
  ].join(" · ");

  const activeContext = CONTEXT_FILTERS.filter((filter) => context[filter.field]);
  const hasFilter = Boolean(search || archived || kind || visibility || activeContext.length > 0);
  // Un prestataire n'a pas accès aux documents commerciaux : pas de filtre qui reste toujours vide.
  const kindChoices = DOCUMENT_KINDS.filter(
    (choice) =>
      canSeeArchives || !(COMMERCIAL_DOCUMENT_KINDS as readonly DocumentKind[]).includes(choice),
  );
  const pastLastPage = documents.items.length === 0 && documents.total > 0;

  const searchParamsLike: SearchParamsLike = params;

  return (
    <>
      <PageHeader
        title="Documents et connaissances"
        subtitle={subtitle}
        actions={
          canManageKnowledge || canCreateDocument ? (
            <DocumentsHeaderActions
              canManageTemplates={canManageKnowledge}
              canCreateDocument={canCreateDocument}
              companies={companies}
              storageConfigured={storage.configured}
              maxBytes={storage.maxBytes}
            />
          ) : undefined
        }
      >
        <SearchField
          param="q"
          label="Rechercher dans les documents, les modèles et la base de connaissances"
          placeholder={
            canReadKnowledge
              ? "Rechercher dans les documents, les modèles et la base de connaissances…"
              : "Rechercher dans les documents…"
          }
          className="anim-header sm:w-full [&_input]:h-11 [&_input]:pl-10 [&_svg]:left-[18px]"
        />
        <FilterBar label="Classement des documents">
          <FilterChip param="type">Tous</FilterChip>
          {kindChoices.map((choice) => (
            <FilterChip key={choice} param="type" value={choice}>
              {DOCUMENT_KIND_LABELS[choice]}
            </FilterChip>
          ))}
          <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
          {DOCUMENT_VISIBILITIES.map((choice) =>
            visibility === choice ? (
              <ActiveFilter
                key={choice}
                href={hrefWith("/documents", searchParamsLike, { partage: null, page: null })}
              >
                {DOCUMENT_VISIBILITY_LABELS[choice]}
              </ActiveFilter>
            ) : (
              <FilterChip key={choice} param="partage" value={choice}>
                {DOCUMENT_VISIBILITY_LABELS[choice]}
              </FilterChip>
            ),
          )}
        </FilterBar>
        {activeContext.length > 0 || archived ? (
          <div className="anim-header -mt-2 flex flex-wrap items-center gap-2">
            {activeContext.map((filter) => (
              <ActiveFilter
                key={filter.param}
                href={hrefWith("/documents", searchParamsLike, {
                  [filter.param]: null,
                  page: null,
                })}
              >
                {filter.label(documents.items[0])}
              </ActiveFilter>
            ))}
            {archived ? (
              <ActiveFilter
                href={hrefWith("/documents", searchParamsLike, { archives: null, page: null })}
              >
                Documents archivés
              </ActiveFilter>
            ) : null}
          </div>
        ) : null}
      </PageHeader>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-(--cols-main-side)">
        <div className="flex min-w-0 flex-col gap-6">
          <DataTable
            caption="Documents"
            columns={columns}
            rows={documents.items}
            rowKey={(row) => row.id}
            rowHref={(row) => `/documents/${row.id}`}
            query={{ pathname: "/documents", searchParams: searchParamsLike }}
            pagination={
              documents.total > documents.pageSize || pastLastPage
                ? { page: documents.page, pageSize: documents.pageSize, total: documents.total }
                : undefined
            }
            empty={
              <EmptyState
                compact
                icon="devis"
                title={
                  pastLastPage
                    ? "Cette page est vide"
                    : hasFilter
                      ? "Aucun document trouvé"
                      : "Aucun document pour l'instant"
                }
                description={
                  pastLastPage
                    ? "Revenez à une page précédente."
                    : hasFilter
                      ? "Essayez un autre terme : le titre, le client, le projet ou le contrat."
                      : canSeeArchives
                        ? "Ajoutez un brief, un contrat ou une maquette pour le retrouver ici."
                        : "Les documents de vos projets et de vos demandes arrivent ici."
                }
              />
            }
          />

          {canReadKnowledge ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div className="contents" style={staggerIndex(1)}>
                <InfoCard
                  icon="edit"
                  title="Modèles"
                  aside={<CardLink href="/documents/modeles" />}
                  className="h-fit"
                >
                  <TemplateList
                    items={templates.items}
                    empty={{
                      title: "Aucun modèle",
                      description: "Briefs, messages et plans de projet réutilisables.",
                    }}
                  />
                </InfoCard>
              </div>
              <div className="contents" style={staggerIndex(2)}>
                <InfoCard
                  icon="check"
                  title="Checklists"
                  aside={<CardLink href="/documents/modeles?type=checklist" />}
                  className="h-fit"
                >
                  <TemplateList
                    items={checklists.items}
                    empty={{
                      title: "Aucune checklist",
                      description: "Production, recette et livraison, à passer en revue.",
                    }}
                  />
                </InfoCard>
              </div>
            </div>
          ) : null}
          {canSeeArchives && !archived ? (
            <div>
              <CompactLink
                variant="quiet"
                scroll={false}
                href={hrefWith("/documents", searchParamsLike, { archives: 1, page: null })}
              >
                Voir les documents archivés
              </CompactLink>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {canReadKnowledge ? (
            <div className="contents" style={staggerIndex(3)}>
              <InfoCard
                icon="book"
                title="Base de connaissances"
                aside={
                  <span className="-my-1 flex items-center gap-3">
                    {canManageKnowledge ? <AddArticleButton /> : null}
                    <CompactLink variant="quiet" href="/documents/connaissances">
                      Tout voir
                    </CompactLink>
                  </span>
                }
                className="h-fit"
              >
                <ArticleList items={articles.items} />
              </InfoCard>
            </div>
          ) : null}
          {latest ? (
            <div className="contents" style={staggerIndex(4)}>
              <InfoCard
                icon="clock"
                title={
                  <Link href={`/documents/${latest.id}`} className="hover:text-accent">
                    Historique · {latest.title}
                  </Link>
                }
                className="h-fit"
              >
                <InfoRows
                  rows={historyRows(history, latest)}
                  className="[&_dd]:text-cell [&_dt]:text-cell"
                />
              </InfoCard>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

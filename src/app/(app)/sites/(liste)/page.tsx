import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState, StaleData } from "@/components/states/states";
import { ButtonExternalLink } from "@/components/ui/button";
import { DataTablePagination, SORT_DIRECTION_PARAM, SORT_PARAM } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import {
  CMS_KIND_LABELS,
  CMS_KINDS,
  ENVIRONMENT_STATUS_LABELS,
  ENVIRONMENT_STATUSES,
} from "@/lib/domain-enums";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { hrefWith, paramValue, type SearchParamsLike } from "@/lib/url-state";
import { SiteCard } from "@/modules/sites/components/site-card";
import { SiteFormButton } from "@/modules/sites/components/site-form";
import { SitesTable } from "@/modules/sites/components/sites-table";
import { SyncStrip } from "@/modules/sites/components/sync-strip";
import { UrlSelectFilter } from "@/modules/sites/components/url-select-filter";
import { isStale, STATUS_STALE_AFTER_MS } from "@/modules/sites/site.health";
import type { SiteListFilter } from "@/modules/sites/site.schema";
import {
  getSiteFormOptions,
  getSitesOverview,
  listSites,
  summarizeSites,
} from "@/modules/sites/site.service";
import { getSitesIntegrationState } from "@/modules/sites/sync.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination, totalPages } from "@/server/pagination";

export const metadata = { title: "Sites et CMS" };

const FILTERS: Record<string, SiteListFilter> = {
  "en-ligne": "live",
  preprod: "staging",
  heberges: "hosted",
  archives: "archived",
};

const CARDS_PER_PAGE = 12;
const ROWS_PER_PAGE = 25;

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "sites:read")) {
    return (
      <>
        <PageHeader title="Sites et CMS" />
        <ForbiddenState />
      </>
    );
  }

  const params: SearchParamsLike = await searchParams;
  const view = paramValue(params, "vue") === "table" ? "table" : "cards";
  const search = paramValue(params, "q");
  const filterKey = paramValue(params, "filtre");
  const companyId = paramValue(params, "client");
  const cmsKind = paramValue(params, "cms");
  const environmentStatus = paramValue(params, "etat");
  const pagination = parsePagination(
    { page: paramValue(params, "page") },
    { defaultPageSize: view === "table" ? ROWS_PER_PAGE : CARDS_PER_PAGE },
  );
  const now = new Date();

  const [overview, sites, options, integrations] = await Promise.all([
    getSitesOverview(ctx),
    listSites(
      ctx,
      {
        search,
        filter: filterKey ? FILTERS[filterKey] : undefined,
        companyId,
        cmsKind,
        environmentStatus,
        sort: paramValue(params, SORT_PARAM),
        direction: paramValue(params, SORT_DIRECTION_PARAM),
      },
      pagination,
      now,
    ),
    getSiteFormOptions(ctx),
    getSitesIntegrationState(ctx),
  ]);

  // Page au-delà de la fin (URL ancienne, sites archivés entre-temps) : la dernière page existante.
  if (sites.items.length === 0 && sites.total > 0) {
    redirect(hrefWith("/sites", params, { page: totalPages(sites) }));
  }

  const consoleUrl = integrations.coolify.consoleUrl;
  const canCreate = can(ctx.actor, "sites:create");
  const filtered = Boolean(search || filterKey || companyId || cmsKind || environmentStatus);
  const coolifyStale =
    integrations.coolify.configured &&
    integrations.coolify.lastSuccessAt &&
    isStale(integrations.coolify.lastSuccessAt, now, STATUS_STALE_AFTER_MS);

  const empty = filtered ? (
    <EmptyState
      icon="search"
      title="Aucun site ne correspond"
      description="Modifiez la recherche ou les filtres."
    />
  ) : (
    <EmptyState
      icon="sites"
      title="Aucun site enregistré"
      description="Ajoutez le premier site pour suivre ses environnements, ses domaines et ses sauvegardes."
    />
  );

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        className="mb-0 lg:mb-0"
        title="Sites et CMS"
        subtitle={summarizeSites(overview)}
        actions={
          <>
            {consoleUrl ? (
              <ButtonExternalLink href={consoleUrl}>Ouvrir Coolify</ButtonExternalLink>
            ) : null}
            {canCreate ? <SiteFormButton label="Nouveau site" choices={options} /> : null}
          </>
        }
      >
        <FilterBar searchParam="q" searchPlaceholder="Rechercher…" label="Filtrer les sites">
          <FilterChip param="filtre">Tous</FilterChip>
          <FilterChip param="filtre" value="en-ligne">
            En ligne
          </FilterChip>
          <FilterChip param="filtre" value="preprod">
            Préprod
          </FilterChip>
          <FilterChip param="filtre" value="heberges">
            Hébergés par nous
          </FilterChip>
          <FilterChip param="filtre" value="archives">
            Archivés
          </FilterChip>
        </FilterBar>
        <div className="anim-header flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Affichage" className="flex flex-wrap items-center gap-2">
            <FilterChip param="vue">Cartes</FilterChip>
            <FilterChip param="vue" value="table">
              Tableau
            </FilterChip>
            <Link
              href="/sites/domaines"
              className="hit-44 ml-2 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline hover:underline-offset-4"
            >
              Domaines et HTTPS
              <Icon name="chevron" size={14} />
            </Link>
          </div>
          {view === "table" ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <UrlSelectFilter
                param="client"
                label="Filtrer par client"
                allLabel="Tous les clients"
                options={options.companies.map((company) => ({
                  value: company.id,
                  label: company.name,
                }))}
              />
              <UrlSelectFilter
                param="cms"
                label="Filtrer par CMS"
                allLabel="Tous les CMS"
                options={CMS_KINDS.map((kind) => ({
                  value: kind,
                  label: CMS_KIND_LABELS[kind],
                }))}
              />
              <UrlSelectFilter
                param="etat"
                label="Filtrer par état de la production"
                allLabel="Tous les états"
                options={ENVIRONMENT_STATUSES.map((status) => ({
                  value: status,
                  label: ENVIRONMENT_STATUS_LABELS[status],
                }))}
              />
            </div>
          ) : null}
        </div>
      </PageHeader>

      <SyncStrip
        coolify={integrations.coolify}
        uptimeKuma={integrations.uptimeKuma}
        canSync={can(ctx.actor, "sites:update")}
        canOpenConnections={can(ctx.actor, "integrations:read")}
        now={now}
      />
      {coolifyStale && integrations.coolify.lastSuccessAt ? (
        <StaleData
          service="Coolify"
          date={formatDateTime(integrations.coolify.lastSuccessAt)}
          staleness={formatRelativeTime(integrations.coolify.lastSuccessAt, now)}
        />
      ) : null}

      {view === "table" ? (
        <SitesTable
          rows={sites.items}
          total={sites.total}
          page={sites.page}
          pageSize={sites.pageSize}
          searchParams={params}
          now={now}
          empty={empty}
        />
      ) : sites.items.length === 0 ? (
        <div className="rounded-lg bg-surface shadow-soft">{empty}</div>
      ) : (
        <>
          <div className="grid gap-(--grid-gap) lg:grid-cols-2 2xl:grid-cols-(--cols-cards)">
            {sites.items.map((site) => (
              <SiteCard key={site.id} site={site} now={now} />
            ))}
          </div>
          {sites.total > sites.pageSize ? (
            <div className="rounded-lg bg-surface shadow-soft">
              <DataTablePagination
                className="border-t-0"
                query={{ pathname: "/sites", searchParams: params }}
                page={sites.page}
                pageSize={sites.pageSize}
                total={sites.total}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

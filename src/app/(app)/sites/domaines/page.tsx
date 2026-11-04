import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import {
  CellIdentity,
  CellMono,
  DataTable,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { daysFromNow, formatDateNumeric, formatRelativeTime } from "@/lib/format";
import { hrefWith, paramValue, type SearchParamsLike } from "@/lib/url-state";
import {
  DeleteDomainButton,
  DomainFormButton,
  TlsCheckButton,
} from "@/modules/sites/components/domain-controls";
import { listDomains, type DomainRow } from "@/modules/sites/domain.service";
import { EXPIRY_WARNING_DAYS, tlsBadge } from "@/modules/sites/site.health";
import { getSiteFormOptions } from "@/modules/sites/site.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination, totalPages } from "@/server/pagination";

export const metadata = { title: "Domaines et HTTPS" };

const FILTERS: Record<string, "expiring" | "tls"> = { "a-renouveler": "expiring", https: "tls" };

/** Registre des domaines : échéances saisies à la main, certificats contrôlés depuis le serveur. */
export default async function DomainsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  const breadcrumbs = [{ label: "Sites et CMS", href: "/sites" }, { label: "Domaines et HTTPS" }];
  if (!can(ctx.actor, "sites:read")) {
    return (
      <>
        <PageHeader title="Domaines et HTTPS" breadcrumbs={breadcrumbs} />
        <ForbiddenState />
      </>
    );
  }

  const params: SearchParamsLike = await searchParams;
  const search = paramValue(params, "q");
  const filterKey = paramValue(params, "filtre");
  const now = new Date();
  const canUpdate = can(ctx.actor, "sites:update");
  const canArchive = can(ctx.actor, "sites:archive");

  const [domains, all, expiring, options] = await Promise.all([
    listDomains(
      ctx,
      { search, filter: filterKey ? FILTERS[filterKey] : undefined },
      parsePagination({ page: paramValue(params, "page") }),
      now,
    ),
    listDomains(ctx, {}, { page: 1, pageSize: 1 }, now),
    listDomains(ctx, { filter: "expiring" }, { page: 1, pageSize: 1 }, now),
    getSiteFormOptions(ctx),
  ]);

  if (domains.items.length === 0 && domains.total > 0) {
    redirect(hrefWith("/sites/domaines", params, { page: totalPages(domains) }));
  }

  const columns: DataTableColumn<DomainRow>[] = [
    {
      key: "name",
      header: "Domaine",
      primary: true,
      cell: (domain) => (
        <CellIdentity
          title={domain.name}
          subtitle={
            domain.siteName
              ? `${domain.siteName}${domain.siteArchived ? " · site archivé" : ""}`
              : "Sans site rattaché"
          }
        />
      ),
    },
    {
      key: "client",
      header: "Client",
      width: 160,
      hideWhenCollapsed: true,
      cell: (domain) => <span className="block truncate">{domain.companyName}</span>,
    },
    {
      key: "registrar",
      header: "Registrar",
      width: 100,
      hideWhenCollapsed: true,
      cell: (domain) => <span className="block truncate">{domain.registrar ?? "—"}</span>,
    },
    {
      key: "expiry",
      header: "Expiration",
      width: 110,
      cell: (domain) => {
        const days = daysFromNow(domain.expiresOn, now);
        return days !== null && days <= EXPIRY_WARNING_DAYS ? (
          <Badge tone={days < 0 ? "danger" : "warn"}>{formatDateNumeric(domain.expiresOn)}</Badge>
        ) : (
          <CellMono>{formatDateNumeric(domain.expiresOn)}</CellMono>
        );
      },
    },
    {
      key: "tls",
      header: "HTTPS",
      width: 180,
      cell: (domain) => {
        const badge = tlsBadge(domain, now);
        return (
          <span
            title={
              domain.checkedAt ? `Vérifié ${formatRelativeTime(domain.checkedAt, now)}` : undefined
            }
          >
            <Badge tone={badge.tone} className="max-w-full truncate">
              {badge.label}
            </Badge>
          </span>
        );
      },
    },
  ];
  if (canUpdate) {
    columns.push({
      key: "actions",
      header: "Actions",
      width: 270,
      cell: (domain) => (
        <span className="relative z-10 flex flex-wrap items-center gap-x-3">
          <TlsCheckButton domainId={domain.id} />
          <DomainFormButton
            label="Modifier"
            domain={{
              id: domain.id,
              name: domain.name,
              companyId: domain.companyId,
              siteId: domain.siteId,
              siteName: domain.siteName,
              registrar: domain.registrar,
              expiresOn: domain.expiresOn,
              autoRenew: domain.autoRenew,
            }}
          />
          {canArchive ? (
            <DeleteDomainButton
              domainId={domain.id}
              domainName={domain.name}
              siteId={domain.siteId}
            />
          ) : null}
        </span>
      ),
    });
  }

  const subtitle =
    all.total === 0
      ? "Aucun domaine enregistré"
      : `${all.total} domaine${all.total > 1 ? "s" : ""} · ${expiring.total} à renouveler ou à contrôler sous ${EXPIRY_WARNING_DAYS} jours`;

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        className="mb-0 lg:mb-0"
        title="Domaines et HTTPS"
        subtitle={subtitle}
        breadcrumbs={breadcrumbs}
        actions={
          canUpdate ? (
            <DomainFormButton label="Ajouter un domaine" primary companies={options.companies} />
          ) : undefined
        }
      >
        <FilterBar searchParam="q" searchPlaceholder="Rechercher…" label="Filtrer les domaines">
          <FilterChip param="filtre">Tous</FilterChip>
          <FilterChip param="filtre" value="a-renouveler">
            À renouveler
          </FilterChip>
          <FilterChip param="filtre" value="https">
            Problème HTTPS
          </FilterChip>
        </FilterBar>
      </PageHeader>

      <DataTable
        caption="Domaines"
        columns={columns}
        rows={domains.items}
        rowKey={(domain) => domain.id}
        rowHref={(domain) => (domain.siteId ? `/sites/${domain.siteId}` : undefined)}
        rowHeight="lg"
        query={{ pathname: "/sites/domaines", searchParams: params }}
        pagination={{ page: domains.page, pageSize: domains.pageSize, total: domains.total }}
        empty={
          <EmptyState
            icon="globe2"
            title={search || filterKey ? "Aucun domaine ne correspond" : "Aucun domaine enregistré"}
            description={
              search || filterKey ? (
                "Modifiez la recherche ou les filtres."
              ) : (
                <>
                  Un domaine est créé avec son site, ou ajouté ici.{" "}
                  <Link href="/sites" className="text-accent hover:underline">
                    Voir les sites
                  </Link>
                </>
              )
            }
          />
        }
      />
    </div>
  );
}

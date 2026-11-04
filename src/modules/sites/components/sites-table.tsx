import { Badge } from "@/components/ui/badge";
import {
  CellIdentity,
  CellMono,
  DataTable,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { daysFromNow, formatDateNumeric, formatRelativeTime } from "@/lib/format";
import type { SearchParamsLike } from "@/lib/url-state";
import type { ReactNode } from "react";
import { environmentBadge, EXPIRY_WARNING_DAYS, siteHealthBadge } from "../site.health";
import type { SiteSummary } from "../site.service";
import { uptimeLabel } from "./site-card";

/** Registre dense, pour plusieurs centaines de sites : tri et pagination restent côté serveur. */
export function SitesTable({
  rows,
  total,
  page,
  pageSize,
  searchParams,
  now,
  empty,
}: {
  rows: SiteSummary[];
  total: number;
  page: number;
  pageSize: number;
  searchParams: SearchParamsLike;
  now: Date;
  empty: ReactNode;
}) {
  const columns: DataTableColumn<SiteSummary>[] = [
    {
      key: "name",
      header: "Site",
      sortable: true,
      primary: true,
      cell: (site) => <CellIdentity title={site.primaryDomain ?? site.name} subtitle={site.name} />,
    },
    {
      key: "client",
      header: "Client",
      width: 170,
      sortable: true,
      cell: (site) => <span className="block truncate">{site.companyName}</span>,
    },
    {
      key: "status",
      header: "Statut",
      width: 170,
      sortable: true,
      cell: (site) => {
        const badge = siteHealthBadge(site, now);
        return <Badge tone={badge.tone}>{badge.label}</Badge>;
      },
    },
    {
      key: "production",
      header: "Production",
      width: 150,
      hideWhenCollapsed: true,
      cell: (site) => {
        if (!site.productionStatus) return <span className="text-muted">Non déclarée</span>;
        const badge = environmentBadge(
          {
            kind: "production",
            status: site.productionStatus,
            statusCheckedAt: site.productionCheckedAt,
          },
          now,
        );
        return (
          <span
            className="block truncate text-row-secondary"
            title={
              site.productionCheckedAt
                ? `Lu ${formatRelativeTime(site.productionCheckedAt, now)}`
                : "Jamais lu"
            }
          >
            {badge.label.replace("Production · ", "")}
          </span>
        );
      },
    },
    {
      key: "uptime",
      header: "Dispo. 30 j",
      width: 110,
      hideWhenCollapsed: true,
      cell: (site) => <CellMono>{uptimeLabel(site, now)}</CellMono>,
    },
    {
      key: "expiry",
      header: "Domaine",
      width: 110,
      sortable: true,
      cell: (site) => {
        const days = daysFromNow(site.domainExpiresOn, now);
        const warn = days !== null && days <= EXPIRY_WARNING_DAYS;
        return (
          <span className={warn ? "font-mono text-amount-compact text-warn" : undefined}>
            {warn ? (
              formatDateNumeric(site.domainExpiresOn)
            ) : (
              <CellMono>{formatDateNumeric(site.domainExpiresOn)}</CellMono>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <DataTable
      caption="Registre des sites"
      columns={columns}
      rows={rows}
      rowKey={(site) => site.id}
      rowHref={(site) => `/sites/${site.id}`}
      rowHeight="lg"
      query={{ pathname: "/sites", searchParams }}
      pagination={{ page, pageSize, total }}
      empty={empty}
    />
  );
}

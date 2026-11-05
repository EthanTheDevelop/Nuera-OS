import Link from "next/link";
import { EmptyState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { FilterChip } from "@/components/ui/filter-bar";
import { Gauge } from "@/components/ui/gauge";
import { Tile } from "@/components/ui/tile";
import { formatDateShort } from "@/lib/format";
import type { getTicketRecurrence } from "../ticket.service";

interface RecurrenceRow {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  total: number;
  open: number;
  incidents: number;
  notCovered: number;
  lastAt: Date;
}

const counted = (value: number, one: string, many: string) => `${value} ${value > 1 ? many : one}`;

function RecurrenceTile({
  title,
  icon,
  rows,
  emptyText,
}: {
  title: string;
  icon: "clients" | "sites";
  rows: readonly RecurrenceRow[];
  emptyText: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return (
    <Tile icon={icon} title={title}>
      {rows.length === 0 ? (
        <EmptyState compact icon={icon} title={emptyText} />
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <li key={row.id} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <Link
                  href={row.href}
                  className="min-w-0 flex-1 truncate text-row-primary text-ink hover:underline hover:underline-offset-4"
                >
                  {row.title}
                  {row.subtitle ? (
                    <span className="text-row-secondary font-normal text-muted">
                      {" "}
                      · {row.subtitle}
                    </span>
                  ) : null}
                </Link>
                <span className="tabular font-mono text-amount-compact text-ink">{row.total}</span>
              </div>
              <Gauge
                value={row.total}
                max={max}
                index={index}
                label={`Demandes de ${row.title}`}
                valueText={`${row.total} ${row.total > 1 ? "demandes" : "demande"}`}
              />
              <div className="flex flex-wrap items-center gap-1">
                {row.open > 0 ? (
                  <Badge tone="accent">{counted(row.open, "ouverte", "ouvertes")}</Badge>
                ) : null}
                {row.incidents > 0 ? (
                  <Badge tone="danger">{counted(row.incidents, "incident", "incidents")}</Badge>
                ) : null}
                {row.notCovered > 0 ? (
                  <Badge tone="warn">{row.notCovered} hors contrat</Badge>
                ) : null}
                <span className="text-row-secondary text-muted">
                  Dernière le {formatDateShort(row.lastAt)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Tile>
  );
}

/** Clients et sites qui demandent le plus (09.04.03) : de quoi ajuster les contrats. */
export function RecurrenceView({
  data,
}: {
  data: Awaited<ReturnType<typeof getTicketRecurrence>>;
  days: number;
}) {
  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <div role="group" aria-label="Période" className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Sur</span>
        <FilterChip param="periode" value="30">
          30 jours
        </FilterChip>
        <FilterChip param="periode">90 jours</FilterChip>
        <FilterChip param="periode" value="365">
          12 mois
        </FilterChip>
      </div>
      <div className="grid gap-(--grid-gap) lg:grid-cols-2 2xl:grid-cols-(--cols-cards)">
        <RecurrenceTile
          title="Clients les plus demandeurs"
          icon="clients"
          emptyText="Aucune demande sur cette période."
          rows={data.companies.map((company) => ({
            id: company.id,
            title: company.name,
            href: `/support?vue=liste&client=${company.id}`,
            total: company.total,
            open: company.open,
            incidents: company.incidents,
            notCovered: company.notCovered,
            lastAt: company.lastAt,
          }))}
        />
        <RecurrenceTile
          title="Sites les plus demandeurs"
          icon="sites"
          emptyText="Aucune demande rattachée à un site sur cette période."
          rows={data.sites.map((site) => ({
            id: site.id,
            title: site.domain ?? site.name,
            subtitle: site.companyName,
            href: `/support?vue=liste&site=${site.id}`,
            total: site.total,
            open: site.open,
            incidents: site.incidents,
            notCovered: site.notCovered,
            lastAt: site.lastAt,
          }))}
        />
      </div>
    </div>
  );
}

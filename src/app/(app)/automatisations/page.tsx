import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { staggerIndex } from "@/components/motion/stagger";
import { formatDateTime } from "@/lib/format";
import {
  RetryAllButton,
  RetryRunButton,
  RuleSwitch,
} from "@/modules/platform/components/automation-controls";
import {
  listAutomationRules,
  listAutomationRuns,
  type AutomationRuleView,
} from "@/modules/platform/automation.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Automatisations" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const STATUSES = ["failed", "succeeded", "running", "skipped"];

type RunRow = Awaited<ReturnType<typeof listAutomationRuns>>["items"][number];

function RuleCard({
  rule,
  canManage,
  index,
}: {
  rule: AutomationRuleView;
  canManage: boolean;
  index: number;
}) {
  return (
    <article
      className="anim-content flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg bg-surface p-5 shadow-soft md:min-h-[88px] md:px-6 md:py-4"
      style={staggerIndex(index)}
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-pale text-accent"
      >
        <Icon name={rule.icon} size={18} />
      </span>
      <dl className="grid min-w-0 flex-1 basis-64 grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1">
        <dt className="font-mono text-table-head font-normal text-muted">Quand</dt>
        <dd className="text-sm font-semibold text-ink">{rule.trigger}</dd>
        <dt className="font-mono text-table-head font-normal text-muted">Alors</dt>
        <dd className="text-sm text-text">{rule.action}</dd>
      </dl>
      <div className="flex shrink-0 items-center gap-6">
        {rule.tool === "ChatGPT" ? (
          <Badge tone="chatgpt">{rule.tool}</Badge>
        ) : (
          <span className="text-xs text-text">{rule.tool}</span>
        )}
        <span className="text-xs text-muted">
          {rule.runsThisMonth} fois ce mois
          {rule.failedThisMonth > 0 ? (
            <Badge tone="danger" className="ml-2">
              {rule.failedThisMonth} en échec
            </Badge>
          ) : null}
        </span>
        <RuleSwitch
          ruleKey={rule.key}
          name={rule.trigger}
          enabled={rule.enabled}
          canManage={canManage}
        />
      </div>
    </article>
  );
}

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "automations:read")) return <ForbiddenState />;

  const params = await searchParams;
  const status = one(params.statut);
  const page = one(params.page);
  const canManage = can(ctx.actor, "automations:manage");

  const [groups, runs] = await Promise.all([
    listAutomationRules(ctx),
    listAutomationRuns(ctx, {
      status: status && STATUSES.includes(status) ? status : undefined,
      page,
      pageSize: 15,
    }),
  ]);

  const columns: DataTableColumn<RunRow>[] = [
    {
      key: "regle",
      header: "Règle",
      primary: true,
      cell: (row) => (
        <span className="block min-w-0">
          <span className="block text-cell font-semibold text-ink">{row.ruleName}</span>
          {row.error ? <span className="block text-xs text-danger">{row.error}</span> : null}
        </span>
      ),
    },
    {
      key: "etat",
      header: "État",
      width: 120,
      cell: (row) => <StatusBadge kind="automation" status={row.status} />,
    },
    { key: "essais", header: "Essais", width: 70, cell: (row) => row.attempts },
    {
      key: "date",
      header: "Date",
      width: 150,
      cell: (row) => formatDateTime(row.finishedAt ?? row.startedAt),
    },
    ...(canManage
      ? [
          {
            key: "relancer",
            header: "",
            width: 90,
            cell: (row: RunRow) => (row.retryable ? <RetryRunButton runId={row.id} /> : null),
          },
        ]
      : []),
  ];

  // Cascade bornée : 24 cartes à 60 ms laisseraient le bas de page vide près de 2 secondes.
  let rank = 0;
  const nextRank = () => Math.min(rank++, 7);
  return (
    <>
      <PageHeader
        title="Automatisations"
        subtitle="Ce que Nuera OS fait toute seule · Twenty d'abord, n8n quand plusieurs outils sont en jeu"
      />
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.group} aria-label={group.group} className="flex flex-col gap-4">
            <h2 className="anim-header font-mono text-table-head font-normal text-muted uppercase">
              {group.group}
            </h2>
            <div className="flex flex-col gap-6">
              {group.rules.map((rule) => (
                <RuleCard key={rule.key} rule={rule} canManage={canManage} index={nextRank()} />
              ))}
            </div>
          </section>
        ))}

        <section aria-label="Exécutions" className="flex flex-col gap-4">
          <div className="anim-header flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-tile-title text-ink">Exécutions</h2>
            {canManage && runs.failed > 0 ? <RetryAllButton /> : null}
          </div>
          <FilterBar label="Filtrer les exécutions">
            <FilterChip param="statut">Toutes</FilterChip>
            <FilterChip param="statut" value="failed" count={runs.failedTotal}>
              Échecs
            </FilterChip>
            <FilterChip param="statut" value="succeeded">
              Réussies
            </FilterChip>
            <FilterChip param="statut" value="skipped">
              Ignorées
            </FilterChip>
          </FilterBar>
          <DataTable
            caption="Exécutions des automatisations"
            columns={columns}
            rows={runs.items}
            rowKey={(row) => row.id}
            rowHeight="md"
            query={{ pathname: "/automatisations", searchParams: { statut: status } }}
            pagination={{ page: runs.page, pageSize: runs.pageSize, total: runs.total }}
            empty={
              <EmptyState
                compact
                icon="automatisations"
                title="Aucune exécution"
                description="Les règles agissent quand un événement arrive : la première exécution apparaîtra ici."
              />
            }
          />
        </section>
      </div>
    </>
  );
}

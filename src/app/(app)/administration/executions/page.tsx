import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { formatDateTime } from "@/lib/format";
import { listAutomationRuns } from "@/modules/platform/automation.service";
import { RetryAllButton, RetryRunButton } from "@/modules/platform/components/automation-controls";
import { listJobRuns, type JobRunView } from "@/modules/platform/jobs.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Exécutions" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

type RunRow = Awaited<ReturnType<typeof listAutomationRuns>>["items"][number];

const JOB_STATUS = {
  running: <Badge tone="accent">En cours</Badge>,
  succeeded: <Badge tone="success">Réussie</Badge>,
  failed: <Badge tone="danger">Échec</Badge>,
};

const jobColumns: readonly DataTableColumn<JobRunView>[] = [
  {
    key: "tache",
    header: "Tâche",
    primary: true,
    cell: (row) => (
      <span className="block min-w-0">
        <span className="block text-cell font-semibold text-ink">{row.label}</span>
        {row.error ? <span className="block text-xs text-danger">{row.error}</span> : null}
      </span>
    ),
  },
  { key: "etat", header: "État", width: 110, cell: (row) => JOB_STATUS[row.status] },
  { key: "elements", header: "Éléments", width: 90, cell: (row) => row.items },
  {
    key: "date",
    header: "Date",
    width: 150,
    cell: (row) => formatDateTime(row.finishedAt ?? row.startedAt),
  },
];

/** Tout ce qui a tourné : règles d'automatisation et tâches planifiées. */
export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "admin:read")) return <ForbiddenState />;

  const params = await searchParams;
  const [runs, jobs] = await Promise.all([
    listAutomationRuns(ctx, { page: one(params.page), pageSize: 15 }),
    listJobRuns(ctx, { page: Number(one(params.taches)) || 1, pageSize: 15 }),
  ]);
  const canManage = can(ctx.actor, "automations:manage");
  const jobsPageHref = (taches: number) => {
    const query = new URLSearchParams({ taches: String(taches) });
    const page = one(params.page);
    if (page) query.set("page", page);
    return `/administration/executions?${query}`;
  };

  const runColumns: DataTableColumn<RunRow>[] = [
    {
      key: "regle",
      header: "Automatisation",
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
      width: 110,
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

  return (
    <>
      <PageHeader
        title="Exécutions"
        subtitle="Automatisations et tâches planifiées"
        breadcrumbs={[
          { label: "Administration", href: "/administration" },
          { label: "Exécutions" },
        ]}
        actions={canManage && runs.failed > 0 ? <RetryAllButton /> : null}
      />
      <div className="flex flex-col gap-5">
        <DataTable
          caption="Exécutions des automatisations"
          columns={runColumns}
          rows={runs.items}
          rowKey={(row) => row.id}
          rowHeight="md"
          query={{
            pathname: "/administration/executions",
            searchParams: { taches: one(params.taches) },
          }}
          pagination={{ page: runs.page, pageSize: runs.pageSize, total: runs.total }}
          empty={<EmptyState compact icon="automatisations" title="Aucune exécution" />}
        />
        <DataTable
          caption="Tâches planifiées"
          columns={jobColumns}
          rows={jobs.items}
          rowKey={(row) => row.id}
          rowHeight="md"
          empty={
            <EmptyState
              compact
              icon="clock"
              title="Aucune tâche lancée"
              description="Le planificateur appelle /api/jobs : voir docs/ops/jobs.md."
            />
          }
        />
        {jobs.total > jobs.pageSize ? (
          <nav aria-label="Pages des tâches planifiées" className="flex justify-end gap-3">
            {jobs.page > 1 ? (
              <ButtonLink href={jobsPageHref(jobs.page - 1)}>Tâches plus récentes</ButtonLink>
            ) : null}
            {jobs.page * jobs.pageSize < jobs.total ? (
              <ButtonLink href={jobsPageHref(jobs.page + 1)}>Tâches plus anciennes</ButtonLink>
            ) : null}
          </nav>
        ) : null}
      </div>
    </>
  );
}

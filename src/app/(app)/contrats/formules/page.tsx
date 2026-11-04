import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { formatMinutes } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { NewPlanButton, PlanRowActions } from "@/modules/contracts/components/plan-controls";
import { periodLabel } from "@/modules/contracts/contract.format";
import type { MaintenancePlanRow } from "@/modules/contracts/contract.types";
import { listMaintenancePlans } from "@/modules/contracts/maintenance-plan.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata = { title: "Formules de maintenance" };

const TITLE = "Formules de maintenance";

function included(plan: MaintenancePlanRow): string {
  const parts: string[] = [];
  if (plan.includedMinutes) parts.push(formatMinutes(plan.includedMinutes));
  if (plan.includedTickets) {
    parts.push(`${plan.includedTickets} ${plan.includedTickets > 1 ? "demandes" : "demande"}`);
  }
  return parts.join(" · ") || "Sans quota";
}

function delays(plan: MaintenancePlanRow): string {
  if (plan.responseHours === null && plan.resolutionHours === null) return "—";
  return `${plan.responseHours ?? "—"} h / ${plan.resolutionHours ?? "—"} h`;
}

export default async function PlansPage() {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "contracts:read")) {
    return (
      <>
        <PageHeader title={TITLE} />
        <ForbiddenState />
      </>
    );
  }

  const plans = await listMaintenancePlans(ctx);
  const canCreate = can(ctx.actor, "contracts:create");
  const canEdit = can(ctx.actor, "contracts:update");
  const activeCount = plans.filter((plan) => plan.active).length;

  const columns: DataTableColumn<MaintenancePlanRow>[] = [
    {
      key: "plan",
      header: "Formule",
      primary: true,
      cell: (plan) => <CellIdentity title={plan.name} subtitle={plan.description ?? undefined} />,
    },
    {
      key: "price",
      header: "Prix",
      width: 110,
      cell: (plan) => <span className="tabular">{formatCents(plan.priceCents)}</span>,
    },
    { key: "period", header: "Périodicité", width: 110, cell: (plan) => periodLabel(plan.period) },
    { key: "included", header: "Inclus", width: 170, cell: included },
    {
      key: "delays",
      header: "Réponse / résolution",
      width: 150,
      cell: delays,
      hideWhenCollapsed: true,
    },
    {
      key: "contracts",
      header: "Contrats",
      width: 80,
      cell: (plan) => <span className="tabular">{plan.contractCount}</span>,
    },
    {
      key: "state",
      header: "État",
      width: 100,
      cell: (plan) =>
        plan.active ? (
          <Badge tone="success">Proposée</Badge>
        ) : (
          <Badge tone="neutral">Retirée</Badge>
        ),
    },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            width: 190,
            align: "right" as const,
            cell: (plan: MaintenancePlanRow) => <PlanRowActions plan={plan} />,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        className="mb-0 lg:mb-0"
        breadcrumbs={[{ label: "Contrats", href: "/contrats" }, { label: "Formules" }]}
        title={TITLE}
        subtitle={`${activeCount} ${activeCount > 1 ? "formules proposées" : "formule proposée"} · copiées dans chaque contrat à sa création`}
        actions={canCreate ? <NewPlanButton /> : null}
      />
      <DataTable
        caption="Formules de maintenance"
        columns={columns}
        rows={plans}
        rowKey={(plan) => plan.id}
        rowHeight="lg"
        empty={
          <EmptyState
            icon="contrat"
            title="Aucune formule"
            description="Une formule préremplit le prix, les quotas, le périmètre et les délais d'un nouveau contrat."
          />
        }
      />
    </div>
  );
}

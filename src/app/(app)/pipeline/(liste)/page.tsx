import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { KanbanColumnDef, KanbanItem } from "@/components/ui/kanban";
import {
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGES,
  type OpportunityStage,
} from "@/lib/domain-enums";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import { formatCents, formatCentsHT } from "@/lib/money";
import { hrefWith, paramValue, type SearchParamsLike } from "@/lib/url-state";
import { CrmSyncBanner, CrmSyncFootnote } from "@/modules/crm/components/sync-status";
import { listMemberOptions } from "@/modules/crm/company.service";
import { getCrmSyncStatus } from "@/modules/crm/crm.sync.service";
import { NewOpportunityButton } from "@/modules/sales/components/opportunity-form";
import { amountLabel, cardSignal, STAGE_TONES } from "@/modules/sales/components/opportunity-view";
import { PipelineBoard } from "@/modules/sales/components/pipeline-board";
import { PipelineCard } from "@/modules/sales/components/pipeline-card";
import {
  PipelineFilterChips,
  PipelineFilterPanel,
  PipelineViewSwitch,
} from "@/modules/sales/components/pipeline-filters";
import {
  BOARD_CARDS_PER_COLUMN,
  getOpportunityFilterOptions,
  getPipelineBoard,
  getPipelineSummary,
  listOpportunities,
  type OpportunityView,
} from "@/modules/sales/opportunity.service";
import { isOpportunityClosed } from "@/modules/sales/opportunity.status";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import type { ServiceContext } from "@/server/context";

export const metadata: Metadata = { title: "Pipeline" };

const PATH = "/pipeline";

function plural(count: number, one: string, many: string) {
  return `${count} ${count > 1 ? many : one}`;
}

const listColumns: DataTableColumn<OpportunityView>[] = [
  {
    key: "affaire",
    header: "Affaire",
    primary: true,
    sortable: true,
    cell: (row) => (
      <CellIdentity
        name={row.companyName ?? row.name}
        title={row.companyName ?? row.name}
        subtitle={row.companyName ? row.name : row.contactName}
      />
    ),
  },
  {
    key: "stage",
    header: "Étape",
    width: 130,
    cell: (row) => <StatusBadge kind="opportunity" status={row.stage} />,
  },
  {
    key: "montant",
    header: "Montant",
    width: 120,
    sortable: true,
    cell: (row) => <span className="tabular">{amountLabel(row.amountCents)}</span>,
  },
  {
    key: "echeance",
    header: "Clôture",
    width: 90,
    sortable: true,
    hideWhenCollapsed: true,
    cell: (row) => (row.expectedCloseOn ? formatDateShort(row.expectedCloseOn) : "—"),
  },
  {
    key: "action",
    header: "Prochaine action",
    width: 200,
    sortable: true,
    cell: (row) => {
      const signal = cardSignal(row);
      return (
        <span className="block min-w-0">
          {row.nextAction ? <span className="block truncate">{row.nextAction}</span> : null}
          <span
            className={cn(
              "block truncate text-xs",
              signal.tone === "warn" && "text-warn",
              signal.tone === "danger" && "text-danger",
              signal.tone === "muted" && "text-muted",
            )}
          >
            {signal.label}
          </span>
        </span>
      );
    },
  },
  {
    key: "origine",
    header: "Origine",
    width: 110,
    hideWhenCollapsed: true,
    cell: (row) => (row.source ? <Badge>{row.source}</Badge> : "—"),
  },
  {
    key: "owner",
    header: "Associé",
    width: 70,
    hideWhenCollapsed: true,
    cell: (row) =>
      row.ownerName ? <Avatar name={row.ownerName} size={26} label={row.ownerName} /> : "—",
  },
];

function stageParam(raw: SearchParamsLike): OpportunityStage | undefined {
  const value = paramValue(raw, "nouvelle");
  return (OPPORTUNITY_STAGES as readonly string[]).includes(value ?? "")
    ? (value as OpportunityStage)
    : undefined;
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "sales:read")) return <ForbiddenState />;

  const raw = (await searchParams) as Record<string, string | string[] | undefined>;
  const params = {
    responsable: paramValue(raw, "responsable"),
    origine: paramValue(raw, "origine"),
    inactives: paramValue(raw, "inactives"),
    q: paramValue(raw, "q"),
    etape: paramValue(raw, "etape"),
    archivees: paramValue(raw, "archivees"),
    tri: paramValue(raw, "tri"),
    sens: paramValue(raw, "sens"),
    page: paramValue(raw, "page"),
    vue: paramValue(raw, "vue"),
  };
  const isList = params.vue === "liste";
  const canCreate = can(ctx.actor, "sales:create");
  const canUpdate = can(ctx.actor, "sales:update");
  const initialStage = canCreate ? stageParam(raw) : undefined;

  const [summary, filterOptions, members, syncStatus] = await Promise.all([
    getPipelineSummary(ctx),
    getOpportunityFilterOptions(ctx),
    canCreate ? listMemberOptions(ctx) : Promise.resolve([]),
    getCrmSyncStatus(ctx),
  ]);

  const open = summary.filter((column) => !isOpportunityClosed(column.stage));
  const openCount = open.reduce((sum, column) => sum + column.total, 0);
  const openAmount = open.reduce((sum, column) => sum + column.amountCents, 0);
  const subtitle = [
    plural(openCount, "affaire ouverte", "affaires ouvertes"),
    `${formatCentsHT(openAmount)} en jeu`,
    canUpdate && !isList && !params.archivees ? "glissez une carte pour changer d'étape" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const hasFilter = Boolean(
    params.responsable ||
    params.origine ||
    params.inactives ||
    params.q ||
    params.etape ||
    params.archivees,
  );
  const stages = OPPORTUNITY_STAGES.map((stage) => ({
    value: stage,
    label: OPPORTUNITY_STAGE_LABELS[stage],
  }));

  const emptyState = (
    <EmptyState
      icon="pipeline"
      title={hasFilter ? "Aucune affaire ne correspond" : "Aucune affaire pour l'instant"}
      description={
        hasFilter
          ? "Levez un filtre pour élargir la recherche."
          : "Enregistrez un premier lead pour lancer le pipeline."
      }
    />
  );

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        title="Pipeline"
        subtitle={subtitle}
        className="mb-0 lg:mb-0"
        actions={
          <>
            <PipelineFilterPanel
              owners={filterOptions.owners}
              sources={filterOptions.sources}
              stages={stages}
              showStage={isList}
              canSeeArchived={canUpdate}
            />
            {canCreate ? (
              <NewOpportunityButton
                options={{
                  members,
                  sources: filterOptions.sources,
                  canMerge: can(ctx.actor, "crm:merge"),
                }}
                initialStage={initialStage}
                closeHref={hrefWith(PATH, raw, { nouvelle: null })}
              />
            ) : null}
          </>
        }
      >
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <PipelineFilterChips
            owners={filterOptions.owners}
            sources={filterOptions.sources}
            stages={stages}
          />
          <PipelineViewSwitch />
        </div>
      </PageHeader>

      <CrmSyncBanner status={syncStatus} />

      {isList ? (
        <PipelineList ctx={ctx} params={params} empty={emptyState} />
      ) : (
        <PipelineKanban
          ctx={ctx}
          params={params}
          canUpdate={canUpdate}
          canCreate={canCreate}
          raw={raw}
          empty={emptyState}
        />
      )}

      <CrmSyncFootnote status={syncStatus} />
    </div>
  );
}

async function PipelineKanban({
  ctx,
  params,
  canUpdate,
  canCreate,
  raw,
  empty,
}: {
  ctx: ServiceContext;
  params: Record<string, string | undefined>;
  canUpdate: boolean;
  canCreate: boolean;
  raw: Record<string, string | string[] | undefined>;
  empty: ReactNode;
}) {
  const board = await getPipelineBoard(ctx, params);
  const hasCards = board.cards.length > 0;
  if (!hasCards && (params.responsable || params.origine || params.inactives || params.q)) {
    return empty;
  }

  const columns: KanbanColumnDef[] = OPPORTUNITY_STAGES.map((stage) => ({
    id: stage,
    title: OPPORTUNITY_STAGE_LABELS[stage],
    tone: STAGE_TONES[stage],
    // Une affaire archivée ne change plus d'étape : le service refuserait.
    dropDisabled: !canUpdate || Boolean(params.archivees),
    addHref:
      canCreate && !isOpportunityClosed(stage) && !params.archivees
        ? hrefWith(PATH, raw, { nouvelle: stage })
        : undefined,
    addLabel: "Ajouter",
  }));
  const items: KanbanItem[] = board.cards.map((opportunity) => ({
    id: opportunity.id,
    columnId: opportunity.stage,
    label: `${opportunity.companyName ?? opportunity.name}, ${
      opportunity.amountCents === null ? "montant à définir" : formatCents(opportunity.amountCents)
    }`,
    card: <PipelineCard opportunity={opportunity} />,
  }));

  return (
    <>
      <PipelineBoard
        columns={columns}
        items={items}
        names={Object.fromEntries(board.cards.map((card) => [card.id, card.name]))}
      />
      {board.hiddenCount > 0 ? (
        <p className="text-sm text-muted">
          {BOARD_CARDS_PER_COLUMN} cartes au plus par colonne :{" "}
          {plural(
            board.hiddenCount,
            "affaire n'est pas affichée",
            "affaires ne sont pas affichées",
          )}
          . La vue Liste les donne toutes.
        </p>
      ) : null}
    </>
  );
}

async function PipelineList({
  ctx,
  params,
  empty,
}: {
  ctx: ServiceContext;
  params: Record<string, string | undefined>;
  empty: ReactNode;
}) {
  const { items, total, page, pageSize } = await listOpportunities(ctx, params);
  return (
    <DataTable
      caption="Affaires"
      columns={listColumns}
      rows={items}
      rowKey={(row) => row.id}
      rowHref={(row) => `/pipeline/${row.id}`}
      rowHeight="lg"
      query={{ pathname: PATH, searchParams: params }}
      pagination={total > pageSize ? { page, pageSize, total } : undefined}
      empty={empty}
    />
  );
}

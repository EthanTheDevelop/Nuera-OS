import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import type { KanbanColumnDef, KanbanItem } from "@/components/ui/kanban";
import { paramValue, hrefWith, type SearchParamsLike } from "@/lib/url-state";
import {
  TICKET_COVERAGE_LABELS,
  TICKET_COVERAGES,
  TICKET_SEVERITIES,
  TICKET_SEVERITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  type TicketCoverage,
  type TicketSeverity,
  type TicketStatus,
} from "@/lib/domain-enums";
import { ActiveFilters, type ActiveFilter } from "@/modules/support/components/active-filters";
import { RecurrenceView } from "@/modules/support/components/recurrence-view";
import {
  NewTicketButton,
  SupportBoard,
  SupportWorkspace,
} from "@/modules/support/components/support-workspace";
import { ReadonlyBoard } from "@/modules/support/components/readonly-board";
import { TicketCard } from "@/modules/support/components/ticket-card";
import { TicketList } from "@/modules/support/components/ticket-list";
import {
  supportSubtitle,
  toTicketWindowData,
  type TicketWindowData,
} from "@/modules/support/components/ticket-view";
import {
  getCompanyTargets,
  getSupportBoard,
  getSupportOverview,
  getTicketAttachments,
  getTicketComments,
  getTicketDetail,
  getTicketFilterLabels,
  getTicketFormOptions,
  getTicketPeople,
  getTicketRecurrence,
  getTicketTime,
  listTickets,
} from "@/modules/support/ticket.service";
import { can, canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import type { ServiceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { logger } from "@/server/logger";

export const metadata: Metadata = { title: "Demandes et support" };

const PATH = "/support";

/** Points des colonnes : ceux de l'écran 11, plus « Qualifiée » pour les 5 états de l'arbitrage A5. */
const COLUMN_TONES: Record<TicketStatus, KanbanColumnDef["tone"]> = {
  received: "accent",
  qualified: "accent",
  in_progress: "warn",
  resolved: "chatgpt",
  closed: "success",
};

const RECURRENCE_PERIODS = ["30", "90", "365"] as const;

const isStatus = (value?: string): value is TicketStatus =>
  (TICKET_STATUSES as readonly string[]).includes(value ?? "");
const isSeverity = (value?: string): value is TicketSeverity =>
  (TICKET_SEVERITIES as readonly string[]).includes(value ?? "");
const isCoverage = (value?: string): value is TicketCoverage =>
  (TICKET_COVERAGES as readonly string[]).includes(value ?? "");

/** Une section de fiche indisponible n'empêche pas d'ouvrir la fiche. */
async function orNull<T>(section: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    logger.error("support.window_section_failed", { section, error });
    return null;
  }
}

async function loadWindow(
  ctx: ServiceContext,
  ticketId: string,
  now: Date,
): Promise<TicketWindowData> {
  const detail = await getTicketDetail(ctx, ticketId);
  const [comments, time, documents] = await Promise.all([
    orNull("comments", () => getTicketComments(ctx, ticketId)),
    orNull("time", () => getTicketTime(ctx, ticketId)),
    orNull("documents", () => getTicketAttachments(ctx, ticketId)),
  ]);
  return toTicketWindowData({
    detail,
    comments,
    time,
    attachments:
      documents?.map((document) => ({
        id: document.id,
        title: document.title,
        href: document.downloadHref,
        detail: document.filename ?? "",
        shared: document.visibility === "client",
      })) ?? null,
    now,
  });
}

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!canAny(ctx.actor, ["support:read", "support:read_assigned"])) return <ForbiddenState />;

  const params = (await searchParams) as SearchParamsLike;
  const flat = Object.fromEntries(
    ["q", "statut", "gravite", "couverture", "filtre", "client", "site", "tri", "sens", "page"].map(
      (key) => [key, paramValue(params, key)],
    ),
  );
  const canReadAll = can(ctx.actor, "support:read");
  const canUpdate = can(ctx.actor, "support:update");
  const canCreate = can(ctx.actor, "support:create");
  const requestedView = paramValue(params, "vue");
  const view =
    requestedView === "liste" || (requestedView === "recurrence" && canReadAll)
      ? requestedView
      : "tableau";

  const now = new Date();
  const ticketId = paramValue(params, "demande");
  let windowData: TicketWindowData | null = null;
  if (ticketId) {
    try {
      windowData = await loadWindow(ctx, ticketId, now);
    } catch (error) {
      // `loading.tsx` a déjà envoyé l'en-tête 200 : la route stable répond, elle, un vrai 404.
      if (error instanceof NotFoundError) redirect(`/support/${encodeURIComponent(ticketId)}`);
      throw error;
    }
  }

  const [overview, people, formOptions, targets, filterLabels] = await Promise.all([
    getSupportOverview(ctx, now),
    getTicketPeople(ctx),
    canCreate ? getTicketFormOptions(ctx) : null,
    windowData && canUpdate ? getCompanyTargets(ctx, windowData.companyId) : null,
    getTicketFilterLabels(ctx, flat),
  ]);

  const activeFilters: ActiveFilter[] = [];
  if (isStatus(flat.statut)) {
    activeFilters.push({ param: "statut", label: TICKET_STATUS_LABELS[flat.statut] });
  }
  if (isSeverity(flat.gravite)) {
    activeFilters.push({ param: "gravite", label: TICKET_SEVERITY_LABELS[flat.gravite] });
  }
  if (isCoverage(flat.couverture)) {
    activeFilters.push({ param: "couverture", label: TICKET_COVERAGE_LABELS[flat.couverture] });
  }
  if (flat.client) {
    activeFilters.push({ param: "client", label: filterLabels.client ?? "Un client" });
  }
  if (flat.site) {
    activeFilters.push({ param: "site", label: filterLabels.site ?? "Un site" });
  }
  const filtered = activeFilters.length > 0 || Boolean(flat.q) || Boolean(flat.filtre);

  const closeHref = hrefWith(PATH, params, { demande: null });
  const hrefForTicket = (id: string) => hrefWith(PATH, params, { demande: id });
  const newTicketPrefix = closeHref.includes("?") ? `${closeHref}&` : `${closeHref}?`;

  let body: ReactNode;
  if (view === "recurrence") {
    const days = Number(
      RECURRENCE_PERIODS.find((period) => period === paramValue(params, "periode")) ?? "90",
    );
    body = <RecurrenceView data={await getTicketRecurrence(ctx, { days }, now)} days={days} />;
  } else if (view === "liste") {
    const result = await listTickets(ctx, flat);
    body = (
      <TicketList
        result={result}
        params={params}
        path={PATH}
        now={now}
        hrefForTicket={hrefForTicket}
        filtered={filtered}
      />
    );
  } else {
    const columns = await getSupportBoard(ctx, flat);
    const total = columns.reduce((sum, column) => sum + column.total, 0);
    const items: KanbanItem[] = columns.flatMap((column) =>
      column.items.map((row) => ({
        id: row.id,
        columnId: column.status,
        label: `${row.number} · ${row.subject}`,
        card: <TicketCard row={row} href={hrefForTicket(row.id)} now={now} canClose={canUpdate} />,
      })),
    );
    const defs: KanbanColumnDef[] = columns.map((column) => {
      const hidden = column.total - column.items.length;
      return {
        id: column.status,
        title: TICKET_STATUS_LABELS[column.status],
        tone: COLUMN_TONES[column.status],
        total: column.total,
        ...(hidden > 0
          ? {
              addHref: hrefWith(PATH, params, { vue: "liste", statut: column.status, page: null }),
              addLabel: `${hidden} de plus dans la liste`,
            }
          : {}),
      };
    });
    if (total === 0) {
      body = (
        <EmptyState
          icon="support"
          title={
            filtered
              ? "Aucune demande pour ce filtre"
              : canReadAll
                ? "Aucune demande pour le moment"
                : "Aucune demande ne vous est attribuée"
          }
          description={
            filtered
              ? "Modifiez les filtres ou la recherche."
              : canReadAll
                ? "Les demandes du portail, de la surveillance et de l'équipe arrivent ici."
                : "Les demandes attribuées à votre fiche d'équipe apparaîtront ici."
          }
        />
      );
    } else if (canUpdate) {
      body = (
        <SupportBoard
          columns={defs}
          items={items}
          statuses={Object.fromEntries(
            columns.flatMap((column) => column.items.map((row) => [row.id, column.status])),
          )}
          unassigned={columns
            .flatMap((column) => column.items)
            .filter((row) => !row.assigneeMemberId)
            .map((row) => row.id)}
        />
      );
    } else {
      body = <ReadonlyBoard columns={defs} items={items} />;
    }
  }

  return (
    <SupportWorkspace
      window={windowData}
      closeHref={closeHref}
      permissions={{
        canUpdate,
        canComment: canUpdate || can(ctx.actor, "support:read_assigned"),
        canLogTime: can(ctx.actor, "time:create_own"),
        canAttach: can(ctx.actor, "documents:create"),
      }}
      members={people.members}
      mentionCandidates={people.mentionCandidates}
      targets={targets}
      viewer={{ name: ctx.actor.name }}
    >
      <PageHeader
        title="Demandes et support"
        subtitle={supportSubtitle(overview)}
        actions={
          canCreate && formOptions ? (
            <NewTicketButton
              companies={formOptions.companies}
              members={formOptions.members}
              hrefPrefix={newTicketPrefix}
            />
          ) : null
        }
      >
        <FilterBar
          searchParam={view === "recurrence" ? undefined : "q"}
          searchPlaceholder="Demande ou client…"
          label="Vue et filtres"
        >
          <FilterChip param="vue">Tableau</FilterChip>
          <FilterChip param="vue" value="liste">
            Liste
          </FilterChip>
          {canReadAll ? (
            <FilterChip param="vue" value="recurrence">
              Récurrence
            </FilterChip>
          ) : null}
          {view !== "recurrence" ? (
            <>
              <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
              <FilterChip param="filtre">Toutes</FilterChip>
              {canReadAll ? (
                <>
                  <FilterChip param="filtre" value="miennes">
                    Les miennes
                  </FilterChip>
                  <FilterChip param="filtre" value="sans_responsable">
                    Sans responsable
                  </FilterChip>
                </>
              ) : null}
              <FilterChip param="filtre" value="retard">
                En retard
              </FilterChip>
              <FilterChip param="filtre" value="critiques">
                Critiques
              </FilterChip>
              <FilterChip param="filtre" value="incidents">
                Incidents
              </FilterChip>
              <FilterChip param="filtre" value="hors_contrat">
                Hors contrat
              </FilterChip>
              <ActiveFilters filters={activeFilters} path={PATH} params={params} />
            </>
          ) : null}
        </FilterBar>
      </PageHeader>
      {body}
    </SupportWorkspace>
  );
}

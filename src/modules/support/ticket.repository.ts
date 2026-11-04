import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { TICKET_STATUSES, type TicketSeverity, type TicketStatus } from "@/lib/domain-enums";
import {
  companies,
  contracts,
  projects,
  sites,
  teamMembers,
  ticketEvents,
  ticketMessages,
  tickets,
  users,
  type Ticket,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/**
 * Requêtes du module Support : ni règle métier ni contrôle d'accès. Les autres tables ne sont lues
 * que pour leurs libellés : leurs écritures passent par les services de leurs modules.
 */

/** Périmètre de lecture. `assigned` : uniquement les demandes attribuées à cette fiche d'équipe. */
export type TicketScope = { kind: "all" } | { kind: "assigned"; memberId: string | null };

export const OPEN_TICKET_STATUSES = [
  "received",
  "qualified",
  "in_progress",
] as const satisfies readonly TicketStatus[];

export interface TicketFilter {
  search?: string;
  status?: TicketStatus;
  severity?: TicketSeverity;
  coverage?: Ticket["coverage"];
  companyId?: string;
  siteId?: string;
  assigneeMemberId?: string;
  unassigned?: boolean;
  /** Ouvertes dont l'échéance est dépassée à cet instant. */
  overdueAt?: Date;
  /** Incidents d'infrastructure, signalés par la surveillance. */
  incident?: boolean;
  /** Hors forfait ou non couvertes : des travaux à facturer ou à transformer. */
  outsideContract?: boolean;
}

export type TicketSort = "creation" | "echeance" | "gravite";

const notArchived = isNull(tickets.archivedAt);

const scopeClause = (scope: TicketScope): SQL | undefined =>
  scope.kind === "all"
    ? undefined
    : scope.memberId
      ? eq(tickets.assigneeMemberId, scope.memberId)
      : sql`false`;

function filterClause(filter: TicketFilter): SQL[] {
  const clauses: SQL[] = [];
  const search = filter.search?.trim();
  if (search) {
    const pattern = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
    const match = or(
      ilike(tickets.subject, pattern),
      ilike(tickets.number, pattern),
      ilike(companies.name, pattern),
    );
    if (match) clauses.push(match);
  }
  if (filter.status) clauses.push(eq(tickets.status, filter.status));
  if (filter.severity) clauses.push(eq(tickets.severity, filter.severity));
  if (filter.coverage) clauses.push(eq(tickets.coverage, filter.coverage));
  if (filter.companyId) clauses.push(eq(tickets.companyId, filter.companyId));
  if (filter.siteId) clauses.push(eq(tickets.siteId, filter.siteId));
  if (filter.assigneeMemberId) clauses.push(eq(tickets.assigneeMemberId, filter.assigneeMemberId));
  if (filter.unassigned) clauses.push(isNull(tickets.assigneeMemberId));
  if (filter.overdueAt) {
    const open = inArray(tickets.status, OPEN_TICKET_STATUSES);
    clauses.push(open, isNotNull(tickets.dueAt), lte(tickets.dueAt, filter.overdueAt));
  }
  if (filter.incident) clauses.push(eq(tickets.isIncident, true));
  if (filter.outsideContract) clauses.push(inArray(tickets.coverage, ["not_covered", "overage"]));
  return clauses;
}

const whereOf = (scope: TicketScope, filter: TicketFilter = {}) =>
  and(notArchived, scopeClause(scope), ...filterClause(filter));

const severityRank = sql<number>`case ${tickets.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;

/** Ce qu'une carte ou une ligne a besoin d'afficher. */
const rowColumns = {
  id: tickets.id,
  number: tickets.number,
  companyId: tickets.companyId,
  companyName: companies.name,
  siteId: tickets.siteId,
  siteName: sites.name,
  siteDomain: sites.primaryDomain,
  contractId: tickets.contractId,
  contractNumber: contracts.number,
  projectId: tickets.projectId,
  projectNumber: projects.number,
  projectName: projects.name,
  subject: tickets.subject,
  channel: tickets.channel,
  category: tickets.category,
  severity: tickets.severity,
  status: tickets.status,
  assigneeMemberId: tickets.assigneeMemberId,
  assigneeName: teamMembers.fullName,
  dueAt: tickets.dueAt,
  firstResponseAt: tickets.firstResponseAt,
  resolvedAt: tickets.resolvedAt,
  closedAt: tickets.closedAt,
  coverage: tickets.coverage,
  isIncident: tickets.isIncident,
  changeRequestId: tickets.changeRequestId,
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt,
};

const selectRows = (db: Database) =>
  db
    .select(rowColumns)
    .from(tickets)
    .innerJoin(companies, eq(companies.id, tickets.companyId))
    .leftJoin(sites, eq(sites.id, tickets.siteId))
    .leftJoin(contracts, eq(contracts.id, tickets.contractId))
    .leftJoin(projects, eq(projects.id, tickets.projectId))
    .leftJoin(teamMembers, eq(teamMembers.id, tickets.assigneeMemberId));

export type TicketRow = Awaited<ReturnType<typeof selectRows>>[number];

export async function listTicketRows(
  db: Database,
  scope: TicketScope,
  filter: TicketFilter,
  page: { page: number; pageSize: number; sort?: TicketSort; direction?: "asc" | "desc" },
): Promise<{ items: TicketRow[]; total: number }> {
  const where = whereOf(scope, filter);
  const direction = page.direction === "asc" ? asc : desc;
  const order: SQL[] =
    page.sort === "echeance"
      ? [sql`${tickets.dueAt} ${sql.raw(page.direction === "desc" ? "desc" : "asc")} nulls last`]
      : page.sort === "gravite"
        ? [page.direction === "asc" ? sql`${severityRank} desc` : sql`${severityRank} asc`]
        : [];
  const [items, totals] = await Promise.all([
    selectRows(db)
      .where(where)
      .orderBy(...order, direction(tickets.createdAt), desc(tickets.id))
      .limit(page.pageSize)
      .offset((page.page - 1) * page.pageSize),
    db
      .select({ total: count() })
      .from(tickets)
      .innerJoin(companies, eq(companies.id, tickets.companyId))
      .where(where),
  ]);
  return { items, total: totals[0]?.total ?? 0 };
}

/**
 * Une colonne du tableau, bornée : les plus graves et les plus proches de l'échéance d'abord ; dans
 * « Clôturée », les plus récentes.
 */
export async function listBoardColumn(
  db: Database,
  scope: TicketScope,
  filter: TicketFilter,
  status: TicketStatus,
  limit: number,
): Promise<TicketRow[]> {
  const order: SQL[] =
    status === "closed"
      ? [sql`${tickets.closedAt} desc nulls last`, desc(tickets.updatedAt)]
      : status === "resolved"
        ? [sql`${tickets.resolvedAt} desc nulls last`, desc(tickets.updatedAt)]
        : [sql`${severityRank} asc`, sql`${tickets.dueAt} asc nulls last`, asc(tickets.createdAt)];
  return selectRows(db)
    .where(whereOf(scope, { ...filter, status }))
    .orderBy(...order)
    .limit(limit);
}

export async function countByStatus(
  db: Database,
  scope: TicketScope,
  filter: TicketFilter = {},
): Promise<Record<TicketStatus, number>> {
  const rows = await db
    .select({ status: tickets.status, total: count() })
    .from(tickets)
    .innerJoin(companies, eq(companies.id, tickets.companyId))
    .where(whereOf(scope, filter))
    .groupBy(tickets.status);
  const counts = Object.fromEntries(TICKET_STATUSES.map((status) => [status, 0])) as Record<
    TicketStatus,
    number
  >;
  for (const row of rows) counts[row.status] = row.total;
  return counts;
}

export interface TicketCounters {
  overdue: number;
  critical: number;
  unassigned: number;
  closedSince: number;
  avgFirstResponseMinutes: number | null;
}

/** Indicateurs de l'en-tête. Délai de réponse moyen sur les demandes ouvertes depuis `since`. */
export async function readCounters(
  db: Database,
  scope: TicketScope,
  now: Date,
  since: { responseSince: Date; closedSince: Date },
): Promise<TicketCounters> {
  const open = sql.raw(`status in ('received', 'qualified', 'in_progress')`);
  const [row] = await db
    .select({
      overdue: sql<number>`count(*) filter (where ${open} and ${tickets.dueAt} < ${now})`.mapWith(
        Number,
      ),
      critical:
        sql<number>`count(*) filter (where ${open} and ${tickets.severity} = 'critical')`.mapWith(
          Number,
        ),
      unassigned:
        sql<number>`count(*) filter (where ${open} and ${tickets.assigneeMemberId} is null)`.mapWith(
          Number,
        ),
      closedSince:
        sql<number>`count(*) filter (where ${tickets.closedAt} >= ${since.closedSince})`.mapWith(
          Number,
        ),
      avgFirstResponseMinutes: sql<
        number | null
      >`avg(extract(epoch from (${tickets.firstResponseAt} - ${tickets.createdAt})) / 60) filter (where ${tickets.firstResponseAt} is not null and ${tickets.createdAt} >= ${since.responseSince} and ${tickets.firstResponseAt} >= ${tickets.createdAt})`.mapWith(
        (value) => (value === null ? null : Number(value)),
      ),
    })
    .from(tickets)
    .where(whereOf(scope));
  return {
    overdue: row?.overdue ?? 0,
    critical: row?.critical ?? 0,
    unassigned: row?.unassigned ?? 0,
    closedSince: row?.closedSince ?? 0,
    avgFirstResponseMinutes: row?.avgFirstResponseMinutes ?? null,
  };
}

// --- Fiche -------------------------------------------------------------------------------------

export async function findTicketRow(
  db: Database,
  scope: TicketScope,
  ticketId: string,
): Promise<(TicketRow & { description: string | null }) | null> {
  const [row] = await db
    .select({ ...rowColumns, description: tickets.description })
    .from(tickets)
    .innerJoin(companies, eq(companies.id, tickets.companyId))
    .leftJoin(sites, eq(sites.id, tickets.siteId))
    .leftJoin(contracts, eq(contracts.id, tickets.contractId))
    .leftJoin(projects, eq(projects.id, tickets.projectId))
    .leftJoin(teamMembers, eq(teamMembers.id, tickets.assigneeMemberId))
    .where(and(eq(tickets.id, ticketId), whereOf(scope)))
    .limit(1);
  return row ?? null;
}

/** Pose un verrou sur la demande : deux changements d'état simultanés s'attendent. */
export async function lockTicket(
  db: Database,
  ticketId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Ticket | null> {
  const [row] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), options.includeArchived ? undefined : notArchived))
    .for("update")
    .limit(1);
  return row ?? null;
}

/** Sérialise jusqu'à la fin de la transaction deux envois simultanés de la même demande. */
export async function lockDuplicateKey(tx: Database, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export async function insertTicket(
  db: Database,
  values: typeof tickets.$inferInsert,
): Promise<Ticket> {
  const [row] = await db.insert(tickets).values(values).returning();
  if (!row) throw new Error("Demande non créée.");
  return row;
}

export async function updateTicketRow(
  db: Database,
  ticketId: string,
  patch: Partial<typeof tickets.$inferInsert>,
): Promise<Ticket> {
  const [row] = await db.update(tickets).set(patch).where(eq(tickets.id, ticketId)).returning();
  if (!row) throw new Error("Demande non mise à jour.");
  return row;
}

/** Même demande ressaisie à l'instant par la même personne : double envoi d'un formulaire. */
export async function findRecentDuplicate(
  db: Database,
  input: { companyId: string; subject: string; openedByUserId: string; since: Date },
): Promise<Ticket | null> {
  const [row] = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.companyId, input.companyId),
        eq(tickets.subject, input.subject),
        eq(tickets.openedByUserId, input.openedByUserId),
        gte(tickets.createdAt, input.since),
        notArchived,
      ),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(1);
  return row ?? null;
}

// --- Incidents ---------------------------------------------------------------------------------

export async function findOpenIncident(db: Database, siteId: string): Promise<Ticket | null> {
  const [row] = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.siteId, siteId),
        eq(tickets.isIncident, true),
        notInArray(tickets.status, ["resolved", "closed"]),
        notArchived,
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Insère l'incident, ou ne fait rien si un incident est déjà ouvert sur ce site. La condition doit
 * reprendre celle de l'index `tickets_open_incident_unique`.
 */
export async function insertIncidentIfNone(
  db: Database,
  values: typeof tickets.$inferInsert,
): Promise<Ticket | null> {
  const [row] = await db
    .insert(tickets)
    .values(values)
    .onConflictDoNothing({
      target: tickets.siteId,
      where: sql.raw(
        `is_incident and site_id is not null and status not in ('resolved', 'closed') and archived_at is null`,
      ),
    })
    .returning();
  return row ?? null;
}

// --- Messages et historique --------------------------------------------------------------------

export async function listMessages(
  db: Database,
  ticketId: string,
  options: { includeInternal: boolean },
) {
  return db
    .select({
      id: ticketMessages.id,
      body: ticketMessages.body,
      internal: ticketMessages.internal,
      at: ticketMessages.at,
      authorUserId: ticketMessages.authorUserId,
      authorName: users.name,
      authorRole: users.role,
    })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.authorUserId))
    .where(
      and(
        eq(ticketMessages.ticketId, ticketId),
        options.includeInternal ? undefined : eq(ticketMessages.internal, false),
      ),
    )
    .orderBy(asc(ticketMessages.at), asc(ticketMessages.createdAt));
}

export async function insertMessage(
  db: Database,
  values: typeof ticketMessages.$inferInsert,
): Promise<typeof ticketMessages.$inferSelect> {
  const [row] = await db.insert(ticketMessages).values(values).returning();
  if (!row) throw new Error("Message non créé.");
  return row;
}

/** Dernier message identique du même auteur : double envoi. */
export async function findRecentSameMessage(
  db: Database,
  input: {
    ticketId: string;
    authorUserId: string;
    body: string;
    internal: boolean;
    since: Date;
  },
) {
  const [row] = await db
    .select()
    .from(ticketMessages)
    .where(
      and(
        eq(ticketMessages.ticketId, input.ticketId),
        eq(ticketMessages.authorUserId, input.authorUserId),
        eq(ticketMessages.body, input.body),
        eq(ticketMessages.internal, input.internal),
        gte(ticketMessages.at, input.since),
      ),
    )
    .orderBy(desc(ticketMessages.at))
    .limit(1);
  return row ?? null;
}

export async function listEvents(db: Database, ticketId: string) {
  return db
    .select({
      id: ticketEvents.id,
      fromStatus: ticketEvents.fromStatus,
      toStatus: ticketEvents.toStatus,
      note: ticketEvents.note,
      at: ticketEvents.at,
      actorName: users.name,
    })
    .from(ticketEvents)
    .leftJoin(users, eq(users.id, ticketEvents.actorId))
    .where(eq(ticketEvents.ticketId, ticketId))
    .orderBy(asc(ticketEvents.at), asc(ticketEvents.createdAt));
}

export async function insertEvent(
  db: Database,
  values: typeof ticketEvents.$inferInsert,
): Promise<void> {
  await db.insert(ticketEvents).values(values);
}

// --- Rattachements -----------------------------------------------------------------------------

export async function findCompanyLabel(db: Database, companyId: string) {
  const [row] = await db
    .select({ id: companies.id, name: companies.name, archivedAt: companies.archivedAt })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row ?? null;
}

export async function findSiteLink(db: Database, siteId: string) {
  const [row] = await db
    .select({
      id: sites.id,
      companyId: sites.companyId,
      contractId: sites.contractId,
      name: sites.name,
      primaryDomain: sites.primaryDomain,
      archivedAt: sites.archivedAt,
    })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  return row ?? null;
}

export async function findContractLink(db: Database, contractId: string) {
  const [row] = await db
    .select({
      id: contracts.id,
      companyId: contracts.companyId,
      number: contracts.number,
      status: contracts.status,
      responseHours: contracts.responseHours,
      resolutionHours: contracts.resolutionHours,
      includedTickets: contracts.includedTickets,
      archivedAt: contracts.archivedAt,
    })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  return row ?? null;
}

export async function findProjectLink(db: Database, projectId: string) {
  const [row] = await db
    .select({ id: projects.id, companyId: projects.companyId, archivedAt: projects.archivedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ?? null;
}

/** Sites, contrats et projets d'un client : les listes de choix du formulaire. */
export async function listCompanyTargets(db: Database, companyId: string) {
  const [siteRows, contractRows, projectRows] = await Promise.all([
    db
      .select({ id: sites.id, name: sites.name, domain: sites.primaryDomain })
      .from(sites)
      .where(and(eq(sites.companyId, companyId), isNull(sites.archivedAt)))
      .orderBy(asc(sites.name))
      .limit(200),
    db
      .select({ id: contracts.id, number: contracts.number, name: contracts.name })
      .from(contracts)
      .where(
        and(
          eq(contracts.companyId, companyId),
          isNull(contracts.archivedAt),
          ne(contracts.status, "terminated"),
        ),
      )
      .orderBy(desc(contracts.createdAt))
      .limit(100),
    db
      .select({ id: projects.id, number: projects.number, name: projects.name })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), isNull(projects.archivedAt)))
      .orderBy(desc(projects.createdAt))
      .limit(100),
  ]);
  return { sites: siteRows, contracts: contractRows, projects: projectRows };
}

// --- Analyse -----------------------------------------------------------------------------------

export async function topCompanies(db: Database, since: Date, limit: number) {
  return db
    .select({
      id: companies.id,
      name: companies.name,
      total: count(),
      open: sql<number>`count(*) filter (where ${tickets.status} in ('received', 'qualified', 'in_progress'))`.mapWith(
        Number,
      ),
      incidents: sql<number>`count(*) filter (where ${tickets.isIncident})`.mapWith(Number),
      notCovered:
        sql<number>`count(*) filter (where ${tickets.coverage} in ('not_covered', 'overage'))`.mapWith(
          Number,
        ),
      lastAt: sql<Date>`max(${tickets.createdAt})`.mapWith(tickets.createdAt),
    })
    .from(tickets)
    .innerJoin(companies, eq(companies.id, tickets.companyId))
    .where(and(notArchived, gte(tickets.createdAt, since)))
    .groupBy(companies.id, companies.name)
    .orderBy(desc(count()), asc(companies.name))
    .limit(limit);
}

export async function topSites(db: Database, since: Date, limit: number) {
  return db
    .select({
      id: sites.id,
      name: sites.name,
      domain: sites.primaryDomain,
      companyName: companies.name,
      total: count(),
      open: sql<number>`count(*) filter (where ${tickets.status} in ('received', 'qualified', 'in_progress'))`.mapWith(
        Number,
      ),
      incidents: sql<number>`count(*) filter (where ${tickets.isIncident})`.mapWith(Number),
      notCovered:
        sql<number>`count(*) filter (where ${tickets.coverage} in ('not_covered', 'overage'))`.mapWith(
          Number,
        ),
      lastAt: sql<Date>`max(${tickets.createdAt})`.mapWith(tickets.createdAt),
    })
    .from(tickets)
    .innerJoin(sites, eq(sites.id, tickets.siteId))
    .innerJoin(companies, eq(companies.id, tickets.companyId))
    .where(and(notArchived, gte(tickets.createdAt, since)))
    .groupBy(sites.id, sites.name, sites.primaryDomain, companies.name)
    .orderBy(desc(count()), asc(sites.name))
    .limit(limit);
}

// --- Automatisations ---------------------------------------------------------------------------

/** Demandes ouvertes dont l'échéance tombe avant `before` : en retard comprises. */
export async function listDueBefore(db: Database, before: Date, limit: number) {
  return db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      companyId: tickets.companyId,
      companyName: companies.name,
      severity: tickets.severity,
      status: tickets.status,
      dueAt: tickets.dueAt,
      assigneeMemberId: tickets.assigneeMemberId,
      assigneeUserId: teamMembers.userId,
    })
    .from(tickets)
    .innerJoin(companies, eq(companies.id, tickets.companyId))
    .leftJoin(teamMembers, eq(teamMembers.id, tickets.assigneeMemberId))
    .where(
      and(
        notArchived,
        inArray(tickets.status, OPEN_TICKET_STATUSES),
        isNotNull(tickets.dueAt),
        lte(tickets.dueAt, before),
      ),
    )
    .orderBy(asc(tickets.dueAt))
    .limit(limit);
}

// --- Portail -----------------------------------------------------------------------------------

/** Vue client : aucune donnée interne (responsable, couverture, contrat). */
export async function listPortalRows(db: Database, companyId: string, limit: number) {
  return db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      category: tickets.category,
      status: tickets.status,
      siteId: tickets.siteId,
      siteName: sites.name,
      createdAt: tickets.createdAt,
      resolvedAt: tickets.resolvedAt,
      closedAt: tickets.closedAt,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .leftJoin(sites, eq(sites.id, tickets.siteId))
    .where(and(eq(tickets.companyId, companyId), notArchived))
    .orderBy(desc(tickets.createdAt))
    .limit(limit);
}

export async function findPortalRow(db: Database, companyId: string, ticketId: string) {
  const [row] = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      description: tickets.description,
      category: tickets.category,
      status: tickets.status,
      siteId: tickets.siteId,
      siteName: sites.name,
      createdAt: tickets.createdAt,
      resolvedAt: tickets.resolvedAt,
      closedAt: tickets.closedAt,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .leftJoin(sites, eq(sites.id, tickets.siteId))
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId), notArchived))
    .limit(1);
  return row ?? null;
}

/** Frise côté client : les seuls vrais changements d'état, sans note ni auteur. */
export async function listPortalTimeline(db: Database, ticketId: string) {
  const rows = await db
    .select({
      fromStatus: ticketEvents.fromStatus,
      toStatus: ticketEvents.toStatus,
      at: ticketEvents.at,
    })
    .from(ticketEvents)
    .where(eq(ticketEvents.ticketId, ticketId))
    .orderBy(asc(ticketEvents.at), asc(ticketEvents.createdAt));
  return rows
    .filter((row) => row.fromStatus !== row.toStatus)
    .map((row) => ({ status: row.toStatus, at: row.at }));
}

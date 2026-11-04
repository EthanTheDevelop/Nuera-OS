import {
  and,
  asc,
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
import type { MemberKind, MissionStatus } from "@/lib/domain-enums";
import {
  companies,
  memberAbsences,
  missions,
  projects,
  tasks,
  teamMembers,
  tickets,
  users,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";

export const OPEN_MISSION_STATUSES = ["planned", "in_progress"] as const;
const CLOSED_TICKET_STATUSES = ["resolved", "closed"] as const;
const CLOSED_PROJECT_STATUSES = ["delivered", "closed"] as const;

/** Verrou le temps de la transaction : deux envois simultanés passent l'un après l'autre. */
export async function lockKey(db: Database, key: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

// --- Membres -------------------------------------------------------------------------------------

export interface MemberFilters {
  kinds?: readonly MemberKind[];
  status?: "active" | "inactive";
  search?: string;
  /** `true` : uniquement les archivés. Défaut : uniquement les fiches vivantes. */
  archived?: boolean;
}

function memberWhere(filters: MemberFilters): SQL | undefined {
  const search = filters.search?.trim();
  return and(
    filters.archived ? isNotNull(teamMembers.archivedAt) : isNull(teamMembers.archivedAt),
    filters.kinds ? inArray(teamMembers.kind, [...filters.kinds]) : undefined,
    filters.status ? eq(teamMembers.status, filters.status) : undefined,
    search
      ? or(
          ilike(teamMembers.fullName, `%${search}%`),
          ilike(teamMembers.title, `%${search}%`),
          ilike(teamMembers.specialty, `%${search}%`),
          sql`exists (select 1 from unnest(${teamMembers.skills}) skill where skill ilike ${`%${search}%`})`,
        )
      : undefined,
  );
}

export function listMembers(db: Database, filters: MemberFilters, limit: number, offset: number) {
  return db
    .select()
    .from(teamMembers)
    .where(memberWhere(filters))
    .orderBy(asc(teamMembers.fullName))
    .limit(limit)
    .offset(offset);
}

export async function countMembers(db: Database, filters: MemberFilters): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(teamMembers)
    .where(memberWhere(filters));
  return row?.total ?? 0;
}

export async function countMembersByKind(db: Database) {
  return db
    .select({ kind: teamMembers.kind, total: sql<number>`count(*)::int` })
    .from(teamMembers)
    .where(and(isNull(teamMembers.archivedAt), eq(teamMembers.status, "active")))
    .groupBy(teamMembers.kind);
}

export async function getMember(db: Database, id: string) {
  const [row] = await db.select().from(teamMembers).where(eq(teamMembers.id, id)).limit(1);
  return row ?? null;
}

export async function findRecentMember(
  db: Database,
  values: { fullName: string; kind: MemberKind; email: string | null },
  since: Date,
) {
  const [row] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.fullName, values.fullName),
        eq(teamMembers.kind, values.kind),
        values.email ? eq(teamMembers.email, values.email) : isNull(teamMembers.email),
        gte(teamMembers.createdAt, since),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export async function findMemberByEmail(db: Database, email: string, excludingId?: string) {
  const [row] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        sql`lower(${teamMembers.email}) = ${email.toLowerCase()}`,
        isNull(teamMembers.archivedAt),
        excludingId ? ne(teamMembers.id, excludingId) : undefined,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export async function insertMember(db: Database, values: typeof teamMembers.$inferInsert) {
  const [row] = await db.insert(teamMembers).values(values).returning();
  if (!row) throw new Error("Membre non créé");
  return row;
}

export async function updateMember(
  db: Database,
  id: string,
  values: Partial<typeof teamMembers.$inferInsert>,
) {
  const [row] = await db
    .update(teamMembers)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(teamMembers.id, id))
    .returning();
  if (!row) throw new Error("Membre non modifié");
  return row;
}

// --- Absences ------------------------------------------------------------------------------------

export function listAbsences(db: Database, memberId: string, since?: string) {
  return db
    .select()
    .from(memberAbsences)
    .where(
      and(
        eq(memberAbsences.memberId, memberId),
        since ? gte(memberAbsences.endOn, since) : undefined,
      ),
    )
    .orderBy(asc(memberAbsences.startOn));
}

/** Absences de plusieurs membres sur une période, pour les cartes de l'équipe. */
export function listAbsencesBetween(
  db: Database,
  memberIds: readonly string[],
  from: string,
  to: string,
) {
  if (memberIds.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(memberAbsences)
    .where(
      and(
        inArray(memberAbsences.memberId, [...memberIds]),
        lte(memberAbsences.startOn, to),
        gte(memberAbsences.endOn, from),
      ),
    )
    .orderBy(asc(memberAbsences.startOn));
}

export async function findOverlappingAbsence(
  db: Database,
  memberId: string,
  startOn: string,
  endOn: string,
) {
  const [row] = await db
    .select()
    .from(memberAbsences)
    .where(
      and(
        eq(memberAbsences.memberId, memberId),
        lte(memberAbsences.startOn, endOn),
        gte(memberAbsences.endOn, startOn),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getAbsence(db: Database, id: string) {
  const [row] = await db.select().from(memberAbsences).where(eq(memberAbsences.id, id)).limit(1);
  return row ?? null;
}

export async function insertAbsence(db: Database, values: typeof memberAbsences.$inferInsert) {
  const [row] = await db.insert(memberAbsences).values(values).returning();
  if (!row) throw new Error("Absence non créée");
  return row;
}

export async function deleteAbsence(db: Database, id: string): Promise<void> {
  await db.delete(memberAbsences).where(eq(memberAbsences.id, id));
}

// --- Missions ------------------------------------------------------------------------------------

const missionSelection = {
  id: missions.id,
  memberId: missions.memberId,
  memberName: teamMembers.fullName,
  memberKind: teamMembers.kind,
  companyId: missions.companyId,
  companyName: companies.name,
  projectId: missions.projectId,
  projectName: projects.name,
  taskId: missions.taskId,
  taskTitle: tasks.title,
  ticketId: missions.ticketId,
  ticketNumber: tickets.number,
  ticketSubject: tickets.subject,
  title: missions.title,
  deliverableLabel: missions.deliverableLabel,
  deliverableReceivedOn: missions.deliverableReceivedOn,
  dueOn: missions.dueOn,
  status: missions.status,
  plannedCostCents: missions.plannedCostCents,
  committedCostCents: missions.committedCostCents,
  createdAt: missions.createdAt,
};

export interface MissionRow {
  id: string;
  memberId: string;
  memberName: string;
  memberKind: MemberKind;
  companyId: string | null;
  companyName: string | null;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  ticketId: string | null;
  ticketNumber: string | null;
  ticketSubject: string | null;
  title: string;
  deliverableLabel: string | null;
  deliverableReceivedOn: string | null;
  dueOn: string | null;
  status: MissionStatus;
  plannedCostCents: number | null;
  committedCostCents: number | null;
  createdAt: Date;
}

export interface MissionFilters {
  memberId?: string;
  companyId?: string;
  projectId?: string;
  status?: MissionStatus;
  open?: boolean;
  search?: string;
}

function missionWhere(filters: MissionFilters): SQL | undefined {
  const search = filters.search?.trim();
  return and(
    filters.memberId ? eq(missions.memberId, filters.memberId) : undefined,
    filters.companyId ? eq(missions.companyId, filters.companyId) : undefined,
    filters.projectId ? eq(missions.projectId, filters.projectId) : undefined,
    filters.status ? eq(missions.status, filters.status) : undefined,
    filters.open ? inArray(missions.status, [...OPEN_MISSION_STATUSES]) : undefined,
    search
      ? or(
          ilike(missions.title, `%${search}%`),
          ilike(missions.deliverableLabel, `%${search}%`),
          ilike(teamMembers.fullName, `%${search}%`),
          ilike(projects.name, `%${search}%`),
        )
      : undefined,
  );
}

function missionQuery(db: Database) {
  return db
    .select(missionSelection)
    .from(missions)
    .innerJoin(teamMembers, eq(teamMembers.id, missions.memberId))
    .leftJoin(companies, eq(companies.id, missions.companyId))
    .leftJoin(projects, eq(projects.id, missions.projectId))
    .leftJoin(tasks, eq(tasks.id, missions.taskId))
    .leftJoin(tickets, eq(tickets.id, missions.ticketId));
}

export function listMissions(
  db: Database,
  filters: MissionFilters,
  limit: number,
  offset: number,
): Promise<MissionRow[]> {
  return missionQuery(db)
    .where(missionWhere(filters))
    .orderBy(sql`${missions.dueOn} asc nulls last`, desc(missions.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function countMissions(db: Database, filters: MissionFilters): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(missions)
    .innerJoin(teamMembers, eq(teamMembers.id, missions.memberId))
    .leftJoin(projects, eq(projects.id, missions.projectId))
    .where(missionWhere(filters));
  return row?.total ?? 0;
}

export async function getMission(db: Database, id: string): Promise<MissionRow | null> {
  const [row] = await missionQuery(db).where(eq(missions.id, id)).limit(1);
  return row ?? null;
}

export async function findRecentMission(
  db: Database,
  values: { memberId: string; title: string; projectId: string | null; ticketId: string | null },
  since: Date,
) {
  const [row] = await db
    .select({ id: missions.id })
    .from(missions)
    .where(
      and(
        eq(missions.memberId, values.memberId),
        eq(missions.title, values.title),
        values.projectId ? eq(missions.projectId, values.projectId) : isNull(missions.projectId),
        values.ticketId ? eq(missions.ticketId, values.ticketId) : isNull(missions.ticketId),
        gte(missions.createdAt, since),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export async function insertMission(db: Database, values: typeof missions.$inferInsert) {
  const [row] = await db.insert(missions).values(values).returning();
  if (!row) throw new Error("Mission non créée");
  return row;
}

export async function updateMission(
  db: Database,
  id: string,
  values: Partial<typeof missions.$inferInsert>,
) {
  const [row] = await db
    .update(missions)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(missions.id, id))
    .returning();
  if (!row) throw new Error("Mission non modifiée");
  return row;
}

/** Ce qui retient l'archivage d'un membre : ses missions, tâches, demandes et projets encore ouverts. */
export async function countOpenWork(db: Database, memberId: string) {
  const [missionRow, taskRow, ticketRow, projectRow] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(missions)
      .where(
        and(eq(missions.memberId, memberId), inArray(missions.status, [...OPEN_MISSION_STATUSES])),
      ),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.assigneeMemberId, memberId),
          ne(tasks.status, "done"),
          isNull(tasks.archivedAt),
        ),
      ),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(tickets)
      .where(
        and(
          eq(tickets.assigneeMemberId, memberId),
          notInArray(tickets.status, [...CLOSED_TICKET_STATUSES]),
          isNull(tickets.archivedAt),
        ),
      ),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(projects)
      .where(
        and(
          eq(projects.ownerMemberId, memberId),
          notInArray(projects.status, [...CLOSED_PROJECT_STATUSES]),
          isNull(projects.archivedAt),
        ),
      ),
  ]);
  return {
    missions: missionRow[0]?.total ?? 0,
    tasks: taskRow[0]?.total ?? 0,
    tickets: ticketRow[0]?.total ?? 0,
    projects: projectRow[0]?.total ?? 0,
  };
}

/** Bilan de plusieurs intervenants : nombre de missions, dernière échéance, coûts cumulés. */
export function summarizeMissions(db: Database, memberIds: readonly string[]) {
  if (memberIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      memberId: missions.memberId,
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${inArray(missions.status, [...OPEN_MISSION_STATUSES])})::int`,
      delivered: sql<number>`count(*) filter (where ${eq(missions.status, "delivered")})::int`,
      lastDueOn: sql<string | null>`max(${missions.dueOn})`,
      plannedCostCents: sql<number>`coalesce(sum(${missions.plannedCostCents}) filter (where ${ne(missions.status, "cancelled")}), 0)::int`,
      committedCostCents: sql<number>`coalesce(sum(${missions.committedCostCents}) filter (where ${ne(missions.status, "cancelled")}), 0)::int`,
    })
    .from(missions)
    .where(inArray(missions.memberId, [...memberIds]))
    .groupBy(missions.memberId);
}

/** Coûts de sous-traitance de toute l'agence : prévu et engagé, missions annulées exclues. */
export async function sumSubcontractingCosts(db: Database) {
  const [row] = await db
    .select({
      plannedCostCents: sql<number>`coalesce(sum(${missions.plannedCostCents}), 0)::int`,
      committedCostCents: sql<number>`coalesce(sum(${missions.committedCostCents}), 0)::int`,
    })
    .from(missions)
    .innerJoin(teamMembers, eq(teamMembers.id, missions.memberId))
    .where(and(eq(teamMembers.kind, "contractor"), ne(missions.status, "cancelled")));
  return row ?? { plannedCostCents: 0, committedCostCents: 0 };
}

// --- Rattachements d'une mission -------------------------------------------------------------------

export async function getProjectLink(db: Database, id: string) {
  const [row] = await db
    .select({ id: projects.id, companyId: projects.companyId })
    .from(projects)
    .where(and(eq(projects.id, id), isNull(projects.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function getTaskLink(db: Database, id: string) {
  const [row] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.id, id), isNull(tasks.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function getTicketLink(db: Database, id: string) {
  const [row] = await db
    .select({ id: tickets.id, companyId: tickets.companyId })
    .from(tickets)
    .where(and(eq(tickets.id, id), isNull(tickets.archivedAt)))
    .limit(1);
  return row ?? null;
}

// --- Comptes ---------------------------------------------------------------------------------------

export async function getUser(db: Database, id: string) {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row ?? null;
}

/** Comptes d'équipe sans fiche, plus celui de ce membre. Jamais un compte client. */
export function listLinkableUsers(db: Database, memberId: string) {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      linkedMemberId: teamMembers.id,
    })
    .from(users)
    .leftJoin(teamMembers, eq(teamMembers.userId, users.id))
    .where(
      and(
        ne(users.role, "client"),
        eq(users.banned, false),
        or(isNull(teamMembers.id), eq(teamMembers.id, memberId)),
      ),
    )
    .orderBy(asc(users.name));
}

export async function findMemberByUser(db: Database, userId: string) {
  const [row] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .limit(1);
  return row?.id ?? null;
}

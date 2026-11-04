import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { AppointmentStatus } from "@/lib/domain-enums";
import {
  appointments,
  companies,
  contacts,
  opportunities,
  projects,
  teamMembers,
  webhookReceipts,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { pageOffset, paginated, type PageParams, type Paginated } from "@/server/pagination";
import type { AppointmentScope } from "./appointment.schema";

const FIELDS = {
  id: appointments.id,
  title: appointments.title,
  kind: appointments.kind,
  startsAt: appointments.startsAt,
  durationMinutes: appointments.durationMinutes,
  channel: appointments.channel,
  location: appointments.location,
  memberIds: appointments.memberIds,
  source: appointments.source,
  status: appointments.status,
  companyId: appointments.companyId,
  companyName: companies.name,
  contactId: appointments.contactId,
  contactFirstName: contacts.firstName,
  contactLastName: contacts.lastName,
  projectId: appointments.projectId,
  projectName: projects.name,
  opportunityId: appointments.opportunityId,
  opportunityName: opportunities.name,
};

export type AppointmentRow = Awaited<ReturnType<typeof findAppointment>> & object;

function baseQuery(db: Database) {
  return db
    .select(FIELDS)
    .from(appointments)
    .leftJoin(companies, eq(appointments.companyId, companies.id))
    .leftJoin(contacts, eq(appointments.contactId, contacts.id))
    .leftJoin(projects, eq(appointments.projectId, projects.id))
    .leftJoin(opportunities, eq(appointments.opportunityId, opportunities.id));
}

export async function findAppointment(db: Database, id: string) {
  const [row] = await baseQuery(db).where(eq(appointments.id, id)).limit(1);
  return row ?? null;
}

function scopeWhere(scope: AppointmentScope, now: Date): SQL | undefined {
  switch (scope) {
    case "upcoming":
      return and(eq(appointments.status, "planned"), gte(appointments.startsAt, now));
    case "past":
      return or(
        eq(appointments.status, "done"),
        and(eq(appointments.status, "planned"), lt(appointments.startsAt, now)),
      );
    case "cancelled":
      return eq(appointments.status, "cancelled");
  }
}

export interface AppointmentLinkFilter {
  companyId?: string;
  opportunityId?: string;
}

function linkWhere(filter: AppointmentLinkFilter): SQL | undefined {
  return and(
    filter.companyId ? eq(appointments.companyId, filter.companyId) : undefined,
    filter.opportunityId ? eq(appointments.opportunityId, filter.opportunityId) : undefined,
  );
}

export async function listAppointments(
  db: Database,
  options: { scope: AppointmentScope; now: Date } & AppointmentLinkFilter,
  params: PageParams,
): Promise<Paginated<AppointmentRow>> {
  const where = and(scopeWhere(options.scope, options.now), linkWhere(options));
  const [items, countRows] = await Promise.all([
    baseQuery(db)
      .where(where)
      .orderBy(
        options.scope === "upcoming" ? asc(appointments.startsAt) : desc(appointments.startsAt),
        asc(appointments.id),
      )
      .limit(params.pageSize)
      .offset(pageOffset(params)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(appointments)
      .where(where),
  ]);
  return paginated(items, countRows[0]?.total ?? 0, params);
}

export async function countByScope(db: Database, now: Date, filter: AppointmentLinkFilter = {}) {
  const [row] = await db
    .select({
      upcoming: sql<number>`count(*) filter (where ${scopeWhere("upcoming", now)})::int`,
      past: sql<number>`count(*) filter (where ${scopeWhere("past", now)})::int`,
      cancelled: sql<number>`count(*) filter (where ${scopeWhere("cancelled", now)})::int`,
    })
    .from(appointments)
    .where(linkWhere(filter));
  return row ?? { upcoming: 0, past: 0, cancelled: 0 };
}

export async function listUpcoming(db: Database, limit: number, now: Date) {
  return baseQuery(db)
    .where(scopeWhere("upcoming", now))
    .orderBy(asc(appointments.startsAt))
    .limit(limit);
}

export async function listForCompany(db: Database, companyId: string, limit: number) {
  return baseQuery(db)
    .where(and(eq(appointments.companyId, companyId), ne(appointments.status, "cancelled")))
    .orderBy(desc(appointments.startsAt))
    .limit(limit);
}

export async function listForOpportunity(db: Database, opportunityId: string, limit: number) {
  return baseQuery(db)
    .where(and(eq(appointments.opportunityId, opportunityId), ne(appointments.status, "cancelled")))
    .orderBy(desc(appointments.startsAt))
    .limit(limit);
}

export async function listForPortal(db: Database, companyId: string, limit: number) {
  return db
    .select({
      id: appointments.id,
      title: appointments.title,
      kind: appointments.kind,
      startsAt: appointments.startsAt,
      durationMinutes: appointments.durationMinutes,
      channel: appointments.channel,
      location: appointments.location,
      status: appointments.status,
      memberIds: appointments.memberIds,
    })
    .from(appointments)
    .where(and(eq(appointments.companyId, companyId), ne(appointments.status, "cancelled")))
    .orderBy(desc(appointments.startsAt))
    .limit(limit);
}

/** Prochain rendez-vous d'un projet, sinon du client. */
export async function findNext(
  db: Database,
  scope: { companyId: string; projectId?: string | null },
  now: Date,
) {
  const [row] = await baseQuery(db)
    .where(
      and(
        scopeWhere("upcoming", now),
        eq(appointments.companyId, scope.companyId),
        scope.projectId
          ? or(eq(appointments.projectId, scope.projectId), isNull(appointments.projectId))
          : undefined,
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(1);
  return row ?? null;
}

export async function insertAppointment(db: Database, values: typeof appointments.$inferInsert) {
  const [row] = await db
    .insert(appointments)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: appointments.id });
  return row ?? null;
}

export async function updateAppointment(
  db: Database,
  id: string,
  values: Partial<typeof appointments.$inferInsert>,
): Promise<void> {
  await db.update(appointments).set(values).where(eq(appointments.id, id));
}

/** Écriture conditionnelle : `false` si le statut a changé depuis sa lecture. */
export async function updateAppointmentIfStatus(
  db: Database,
  id: string,
  from: AppointmentStatus,
  values: Partial<typeof appointments.$inferInsert>,
): Promise<boolean> {
  const rows = await db
    .update(appointments)
    .set(values)
    .where(and(eq(appointments.id, id), eq(appointments.status, from)))
    .returning({ id: appointments.id });
  return rows.length > 0;
}

export async function findByExternalId(db: Database, externalId: string) {
  const [row] = await db
    .select({ id: appointments.id, status: appointments.status })
    .from(appointments)
    .where(eq(appointments.externalId, externalId))
    .limit(1);
  return row ?? null;
}

// --- Rattachements -----------------------------------------------------------------------------

export async function findCompanyActive(db: Database, id: string) {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, id), isNull(companies.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function findProjectCompany(db: Database, id: string) {
  const [row] = await db
    .select({ companyId: projects.companyId })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return row ?? null;
}

export async function findOpportunityCompany(db: Database, id: string) {
  const [row] = await db
    .select({ companyId: opportunities.companyId })
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .limit(1);
  return row ?? null;
}

export async function findContactCompany(db: Database, id: string) {
  const [row] = await db
    .select({ companyId: contacts.companyId })
    .from(contacts)
    .where(eq(contacts.id, id))
    .limit(1);
  return row ?? null;
}

export async function listProjectOptions(db: Database, companyId: string) {
  return db
    .select({ id: projects.id, name: projects.name, number: projects.number })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), isNull(projects.archivedAt)))
    .orderBy(desc(projects.createdAt))
    .limit(50);
}

export async function listOpportunityOptions(db: Database, companyId: string) {
  return db
    .select({ id: opportunities.id, name: opportunities.name })
    .from(opportunities)
    .where(and(eq(opportunities.companyId, companyId), isNull(opportunities.archivedAt)))
    .orderBy(desc(opportunities.createdAt))
    .limit(50);
}

// --- Webhook Cal -------------------------------------------------------------------------------

/** `false` si cet envoi a déjà été reçu : Cal peut livrer plusieurs fois le même événement. */
export async function recordReceipt(db: Database, externalId: string): Promise<boolean> {
  const rows = await db
    .insert(webhookReceipts)
    .values({ service: "cal", externalId, status: "processed" })
    .onConflictDoNothing()
    .returning({ id: webhookReceipts.id });
  return rows.length > 0;
}

/** Contact connu par son e-mail (seed d'un rendez-vous pris en ligne), sans fiche créée d'office. */
export async function findContactByEmail(db: Database, email: string) {
  const [row] = await db
    .select({ id: contacts.id, companyId: contacts.companyId })
    .from(contacts)
    .where(and(eq(sql`lower(${contacts.email})`, email.toLowerCase()), isNull(contacts.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function findMemberIdsByEmail(db: Database, emails: string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const rows = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        inArray(
          sql`lower(${teamMembers.email})`,
          emails.map((email) => email.toLowerCase()),
        ),
        isNull(teamMembers.archivedAt),
      ),
    );
  return rows.map((row) => row.id);
}

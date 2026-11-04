import { and, asc, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { activities, opportunities, teamMembers } from "@/server/db/schema";
import type { Activity } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { pageOffset, type PageParams } from "@/server/pagination";
import { isUuid, rowsOf } from "./company.repository";

export async function findActivityById(db: Database, id: string): Promise<Activity | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
  return row ?? null;
}

export async function findActivityByTwentyId(
  db: Database,
  twentyId: string,
): Promise<Activity | null> {
  const [row] = await db
    .select()
    .from(activities)
    .where(eq(activities.twentyId, twentyId))
    .limit(1);
  return row ?? null;
}

export async function insertActivity(
  tx: Database,
  values: typeof activities.$inferInsert,
): Promise<Activity | null> {
  const [row] = await tx.insert(activities).values(values).onConflictDoNothing().returning();
  return row ?? null;
}

export async function updateActivityRow(
  tx: Database,
  id: string,
  values: Partial<typeof activities.$inferInsert>,
): Promise<Activity> {
  const [row] = await tx.update(activities).set(values).where(eq(activities.id, id)).returning();
  if (!row) throw new Error("Activité introuvable au moment de l'écriture");
  return row;
}

export async function findOpportunityLink(db: Database, id: string) {
  const [row] = await db
    .select({
      id: opportunities.id,
      twentyId: opportunities.twentyId,
      companyId: opportunities.companyId,
      archivedAt: opportunities.archivedAt,
    })
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .limit(1);
  return row ?? null;
}

export async function findOpportunityLinkByTwentyId(db: Database, twentyId: string) {
  const [row] = await db
    .select({
      id: opportunities.id,
      twentyId: opportunities.twentyId,
      companyId: opportunities.companyId,
    })
    .from(opportunities)
    .where(eq(opportunities.twentyId, twentyId))
    .limit(1);
  return row ?? null;
}

/** Une activité récente fait sortir l'affaire des « inactives ». */
export async function touchOpportunityActivity(
  tx: Database,
  opportunityId: string,
  at: Date,
): Promise<void> {
  await tx
    .update(opportunities)
    .set({ lastActivityAt: at })
    .where(
      and(
        eq(opportunities.id, opportunityId),
        sql`(${opportunities.lastActivityAt} is null or ${opportunities.lastActivityAt} < ${at.toISOString()}::timestamptz)`,
      ),
    );
}

const ownerName = teamMembers.fullName;

export type ActivityWithOwner = Activity & { ownerName: string | null };

export async function listActivitiesOfCompany(
  db: Database,
  companyId: string,
  options: { limit?: number } = {},
): Promise<ActivityWithOwner[]> {
  const rows = await db
    .select({ activity: activities, ownerName })
    .from(activities)
    .leftJoin(teamMembers, eq(activities.ownerMemberId, teamMembers.id))
    .where(eq(activities.companyId, companyId))
    .orderBy(desc(activities.occurredAt))
    .limit(options.limit ?? 50);
  return rows.map((row) => ({ ...row.activity, ownerName: row.ownerName }));
}

export async function listActivitiesOfOpportunity(
  db: Database,
  opportunityId: string,
  options: { limit?: number } = {},
): Promise<ActivityWithOwner[]> {
  const rows = await db
    .select({ activity: activities, ownerName })
    .from(activities)
    .leftJoin(teamMembers, eq(activities.ownerMemberId, teamMembers.id))
    .where(eq(activities.opportunityId, opportunityId))
    .orderBy(desc(activities.occurredAt))
    .limit(options.limit ?? 50);
  return rows.map((row) => ({ ...row.activity, ownerName: row.ownerName }));
}

export async function listActivitiesOfContact(
  db: Database,
  contactId: string,
  options: { limit?: number } = {},
): Promise<ActivityWithOwner[]> {
  const rows = await db
    .select({ activity: activities, ownerName })
    .from(activities)
    .leftJoin(teamMembers, eq(activities.ownerMemberId, teamMembers.id))
    .where(eq(activities.contactId, contactId))
    .orderBy(desc(activities.occurredAt))
    .limit(options.limit ?? 50);
  return rows.map((row) => ({ ...row.activity, ownerName: row.ownerName }));
}

export async function listOpenTasksOfCompany(db: Database, companyId: string, limit: number) {
  const rows = await db
    .select({ activity: activities, ownerName })
    .from(activities)
    .leftJoin(teamMembers, eq(activities.ownerMemberId, teamMembers.id))
    .where(
      and(
        eq(activities.companyId, companyId),
        eq(activities.kind, "task"),
        isNull(activities.completedAt),
      ),
    )
    .orderBy(sql`${activities.dueAt} asc nulls last`, asc(activities.createdAt))
    .limit(limit);
  return rows.map((row) => ({ ...row.activity, ownerName: row.ownerName }));
}

export type TimelineRow = {
  id: string;
  source: "activity" | "stage" | "event" | "appointment";
  kind: string;
  subject: string;
  body: string | null;
  at: Date;
  owner_name: string | null;
  to_stage: string | null;
  from_stage: string | null;
  opportunity_id: string | null;
  opportunity_name: string | null;
  completed_at: Date | null;
};

/**
 * Mémoire de la relation (écran 04) : échanges, changements d'étape, rendez-vous passés et événements
 * du client (devis signé, acompte encaissé…), du plus récent au plus ancien. Une seule requête : c'est
 * elle qui pagine. `eventTypes` est décidé par le service, selon les droits de l'acteur.
 */
export async function listCompanyTimelinePage(
  db: Database,
  companyId: string,
  params: PageParams,
  eventTypes: readonly string[],
): Promise<{ items: TimelineRow[]; total: number }> {
  const union = sql`
    select a.id, 'activity' as source, a.kind::text as kind, a.subject, a.body, a.occurred_at as at,
           m.full_name as owner_name, null::text as to_stage, null::text as from_stage,
           a.opportunity_id, o.name as opportunity_name, a.completed_at
      from activities a
      left join team_members m on m.id = a.owner_member_id
      left join opportunities o on o.id = a.opportunity_id
     where a.company_id = ${companyId}::uuid
    union all
    select h.id, 'stage', 'stage', o.name, null, h.at,
           u.name, h.to_stage, h.from_stage, o.id, o.name, null
      from opportunity_stage_history h
      join opportunities o on o.id = h.opportunity_id
      left join users u on u.id = h.actor_id
     where o.company_id = ${companyId}::uuid
    union all
    select r.id, 'appointment', 'appointment', r.title, null, r.starts_at,
           null, null, null, r.opportunity_id, o.name, null
      from appointments r
      left join opportunities o on o.id = r.opportunity_id
     where r.company_id = ${companyId}::uuid and r.status <> 'cancelled' and r.starts_at <= now()
    union all
    select e.id, 'event', e.type::text, e.type::text,
           coalesce(e.payload->>'number', e.payload->>'externalRef', e.payload->>'title', e.payload->>'name'),
           e.occurred_at, u.name, null, null, null, null, null
      from domain_events e
      left join users u on u.id = e.actor_id
     where e.company_id = ${companyId}::uuid
       and e.type in (${sql.join(
         eventTypes.map((type) => sql`${type}`),
         sql`, `,
       )})
  `;
  const [items, totals] = await Promise.all([
    db.execute<TimelineRow>(sql`
      select * from (${union}) t order by at desc, id
      limit ${params.pageSize} offset ${pageOffset(params)}
    `),
    db.execute<{ total: number }>(sql`select count(*)::int as total from (${union}) t`),
  ]);
  return {
    items: rowsOf<TimelineRow>(items).map((row) => ({ ...row, at: new Date(row.at) })),
    total: rowsOf<{ total: number }>(totals)[0]?.total ?? 0,
  };
}

/** Lignes de notes et tâches projetées de Twenty encore connues localement. */
export async function listProjectedActivityIds(db: Database, kind: "note" | "task") {
  return db
    .select({ id: activities.id, twentyId: activities.twentyId })
    .from(activities)
    .where(and(eq(activities.kind, kind), isNotNull(activities.twentyId)));
}

export async function deleteActivityByTwentyId(tx: Database, twentyId: string): Promise<boolean> {
  const rows = await tx
    .delete(activities)
    .where(eq(activities.twentyId, twentyId))
    .returning({ id: activities.id });
  return rows.length > 0;
}

export async function countActivities(db: Database, companyId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(activities)
    .where(eq(activities.companyId, companyId));
  return row?.total ?? 0;
}

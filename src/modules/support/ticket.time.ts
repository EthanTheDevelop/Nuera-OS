import { and, desc, eq, sql } from "drizzle-orm";
import { getMemberIdForUser } from "@/modules/team/team.lookup";
import { createTimeEntry } from "@/modules/time/time.service";
import { can } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { teamMembers, timeEntries } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/**
 * Temps passé sur une demande. L'écriture passe par le service du module Temps (coût figé, plafond
 * journalier, périmètre). La lecture par demande n'y existe pas : elle reste ici, sans jamais
 * sélectionner le coût, et un prestataire n'y voit que son propre temps (domain-model §9).
 */
export async function sumTicketMinutes(db: Database, ticketId: string): Promise<number> {
  const [row] = await db
    .select({ minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)`.mapWith(Number) })
    .from(timeEntries)
    .where(eq(timeEntries.ticketId, ticketId));
  return row?.minutes ?? 0;
}

export interface TicketTime {
  totalMinutes: number;
  entries: {
    id: string;
    workOn: string;
    minutes: number;
    memberName: string | null;
    note: string | null;
    billable: boolean;
  }[];
}

const TIME_LIST_LIMIT = 50;

export async function listTicketTime(ctx: ServiceContext, ticketId: string): Promise<TicketTime> {
  const memberId = can(ctx.actor, "time:read")
    ? null
    : await getMemberIdForUser(ctx.db, ctx.actor.userId);
  if (!can(ctx.actor, "time:read") && !memberId) return { totalMinutes: 0, entries: [] };

  const where = and(
    eq(timeEntries.ticketId, ticketId),
    memberId ? eq(timeEntries.memberId, memberId) : undefined,
  );
  const [totals, entries] = await Promise.all([
    ctx.db
      .select({ minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)`.mapWith(Number) })
      .from(timeEntries)
      .where(where),
    ctx.db
      .select({
        id: timeEntries.id,
        workOn: timeEntries.workOn,
        minutes: timeEntries.minutes,
        memberName: teamMembers.fullName,
        note: timeEntries.note,
        billable: timeEntries.billable,
      })
      .from(timeEntries)
      .leftJoin(teamMembers, eq(teamMembers.id, timeEntries.memberId))
      .where(where)
      .orderBy(desc(timeEntries.workOn), desc(timeEntries.createdAt))
      .limit(TIME_LIST_LIMIT),
  ]);
  return { totalMinutes: totals[0]?.minutes ?? 0, entries };
}

export async function addTicketTimeEntry(
  ctx: ServiceContext,
  input: {
    ticketId: string;
    minutes: number;
    workOn: string;
    billable: boolean;
    note: string | null;
  },
) {
  return createTimeEntry(ctx, {
    ticketId: input.ticketId,
    category: "support",
    minutes: input.minutes,
    workOn: input.workOn,
    billable: input.billable,
    note: input.note ?? undefined,
  });
}

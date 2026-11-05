/**
 * Insertion idempotente du plan STAGING, dans une seule transaction.
 *
 * - Une ligne dont l'identifiant existe déjà n'est ni réécrite ni supprimée : relancer la même
 *   graine n'ajoute rien, et ce qui a été modifié à la main dans l'interface est préservé.
 * - Les seules mises à jour portent sur des lignes insérées par ce passage (versions courantes des
 *   devis, document principal des échéances, liens circulaires impossibles à poser d'un coup).
 * - La table `users` n'est jamais lue ni écrite : aucun compte n'est créé, modifié ou supprimé.
 * - Les numéros lisibles viennent des compteurs de l'application (`sequences`), réservés en bloc :
 *   le prochain devis créé à la main ne heurte aucun numéro du jeu de données.
 * - Un verrou consultatif empêche deux exécutions simultanées.
 */
import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { recordAudit } from "@/modules/audit/audit.service";
import {
  formatSequenceNumber,
  sequenceYear,
  type SequenceScope,
} from "@/modules/platform/sequences";
import * as s from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { planCounts, type StagingPlan } from "./generate";

const CHUNK = 200;
const LOCK_KEY = 7_406_202_611;

export interface ApplyOptions {
  referenceDate: Date;
  /** Calcule et insère, puis annule tout : rien n'est écrit. */
  dryRun?: boolean;
  /** Paramètres de génération, consignés dans le journal d'audit. */
  metadata: Record<string, unknown>;
}

export interface ApplyResult {
  planned: Record<string, number>;
  inserted: Record<string, number>;
  dryRun: boolean;
}

class DryRunRollback extends Error {
  constructor(public readonly result: ApplyResult) {
    super("Essai à blanc : transaction annulée.");
  }
}

function chunks<T>(rows: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

type TableWithId = PgTable & { id: AnyPgColumn };

/** Lignes du plan absentes de la base, d'après leur identifiant. */
async function missingRows<T extends { id?: string }>(
  tx: Database,
  table: TableWithId,
  rows: readonly T[],
): Promise<T[]> {
  const existing = new Set<string>();
  const ids = rows.map((row) => row.id).filter((id): id is string => Boolean(id));
  for (const part of chunks(ids, 1000)) {
    const found = await tx.select({ id: table.id }).from(table).where(inArray(table.id, part));
    for (const row of found) existing.add(String(row.id));
  }
  return rows.filter((row) => row.id && !existing.has(row.id));
}

async function insertRows<T extends { id?: string }>(
  tx: Database,
  table: TableWithId,
  rows: readonly T[],
): Promise<number> {
  for (const part of chunks(rows)) {
    // Toute autre collision (numéro, SIREN, référence) lève une erreur et annule tout le passage.
    await tx.insert(table).values(part as never);
  }
  return rows.length;
}

/** Réserve `count` numéros consécutifs pour `(scope, année)` et renvoie le premier. */
async function reserveNumbers(
  tx: Database,
  scope: SequenceScope,
  year: number,
  count: number,
): Promise<number> {
  const [row] = await tx
    .insert(s.sequences)
    .values({ scope, year, value: count })
    .onConflictDoUpdate({
      target: [s.sequences.scope, s.sequences.year],
      set: { value: sql`${s.sequences.value} + ${count}`, updatedAt: new Date() },
    })
    .returning({ value: s.sequences.value });
  if (!row) throw new Error(`Compteur ${scope}/${year} non réservé.`);
  return row.value - count + 1;
}

/** Numérote les nouvelles lignes dans l'ordre chronologique de leur création. */
async function numberRows<T extends { createdAt?: Date }>(
  tx: Database,
  scope: SequenceScope,
  year: number,
  rows: readonly T[],
): Promise<(T & { number: string })[]> {
  if (rows.length === 0) return [];
  const first = await reserveNumbers(tx, scope, year, rows.length);
  return [...rows]
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
    .map((row, index) => ({ ...row, number: formatSequenceNumber(scope, year, first + index) }));
}

export async function applyStagingPlan(
  db: Database,
  plan: StagingPlan,
  options: ApplyOptions,
): Promise<ApplyResult> {
  const year = sequenceYear(options.referenceDate);
  const planned = planCounts(plan);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
      const inserted: Record<string, number> = {};
      const put = async <T extends { id?: string }>(
        name: keyof StagingPlan,
        table: TableWithId,
        rows: readonly T[],
      ): Promise<T[]> => {
        const fresh = await missingRows(tx, table, rows);
        inserted[name] = await insertRows(tx, table, fresh);
        return fresh;
      };

      await put("teamMembers", s.teamMembers, plan.teamMembers);
      await put("memberAbsences", s.memberAbsences, plan.memberAbsences);
      await put("catalogItems", s.catalogItems, plan.catalogItems);

      // SIREN déjà pris par une autre fiche (vraie ou d'une autre graine) : laissé vide.
      const companies = await missingRows(tx, s.companies, plan.companies);
      const sirens = companies.map((row) => row.siren).filter((v): v is string => Boolean(v));
      const taken = new Set<string>();
      for (const part of chunks(sirens, 1000)) {
        const rows = await tx
          .select({ siren: s.companies.siren })
          .from(s.companies)
          .where(and(inArray(s.companies.siren, part), isNull(s.companies.mergedIntoId)));
        for (const row of rows) if (row.siren) taken.add(row.siren);
      }
      inserted.companies = await insertRows(
        tx,
        s.companies,
        companies.map((row) => (row.siren && taken.has(row.siren) ? { ...row, siren: null } : row)),
      );

      await put("contacts", s.contacts, plan.contacts);
      await put("opportunities", s.opportunities, plan.opportunities);
      await put("opportunityStageHistory", s.opportunityStageHistory, plan.opportunityStageHistory);
      await put("activities", s.activities, plan.activities);

      // Devis : insérés sans version, puis reliés à leurs versions une fois celles-ci en place.
      const quotes = await numberRows(
        tx,
        "quote",
        year,
        await missingRows(tx, s.quotes, plan.quotes),
      );
      inserted.quotes = await insertRows(tx, s.quotes, quotes);
      await put("quoteVersions", s.quoteVersions, plan.quoteVersions);
      await put("quoteLines", s.quoteLines, plan.quoteLines);
      const newQuoteIds = new Set(quotes.map((row) => row.id));
      for (const link of plan.quoteVersionLinks) {
        if (!newQuoteIds.has(link.quoteId)) continue;
        await tx
          .update(s.quotes)
          .set({
            currentVersionId: link.currentVersionId,
            acceptedVersionId: link.acceptedVersionId,
          })
          .where(eq(s.quotes.id, link.quoteId));
      }

      const projects = await numberRows(
        tx,
        "project",
        year,
        await missingRows(tx, s.projects, plan.projects),
      );
      inserted.projects = await insertRows(tx, s.projects, projects);
      await put("projectPhases", s.projectPhases, plan.projectPhases);
      await put("projectMembers", s.projectMembers, plan.projectMembers);
      const tasks = await numberRows(tx, "task", year, await missingRows(tx, s.tasks, plan.tasks));
      inserted.tasks = await insertRows(tx, s.tasks, tasks);
      await put("timeEntries", s.timeEntries, plan.timeEntries);
      await put("directCosts", s.directCosts, plan.directCosts);

      // Échéances, puis factures, puis document principal de chaque nouvelle échéance.
      const schedule = await put(
        "paymentScheduleItems",
        s.paymentScheduleItems,
        plan.paymentScheduleItems,
      );
      await put("financialDocuments", s.financialDocuments, plan.financialDocuments);
      const newScheduleIds = new Set(schedule.map((row) => row.id));
      for (const link of plan.scheduleDocumentLinks) {
        if (!newScheduleIds.has(link.scheduleItemId)) continue;
        await tx
          .update(s.paymentScheduleItems)
          .set({ financialDocumentId: link.financialDocumentId })
          .where(eq(s.paymentScheduleItems.id, link.scheduleItemId));
      }

      await put("appointments", s.appointments, plan.appointments);
      const tickets = await numberRows(
        tx,
        "ticket",
        year,
        await missingRows(tx, s.tickets, plan.tickets),
      );
      inserted.tickets = await insertRows(tx, s.tickets, tickets);
      await put("ticketMessages", s.ticketMessages, plan.ticketMessages);
      await put("ticketEvents", s.ticketEvents, plan.ticketEvents);

      const total = Object.values(inserted).reduce((sum, value) => sum + value, 0);
      const result: ApplyResult = { planned, inserted, dryRun: Boolean(options.dryRun) };
      if (options.dryRun) throw new DryRunRollback(result);
      if (total > 0) {
        await recordAudit(tx, {
          actorId: null,
          action: "data_seed.applied",
          entityType: "data_seed",
          entityId: "staging",
          metadata: { via: "cli", ...options.metadata, inserted: total },
        });
      }
      return result;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.result;
    throw error;
  }
}

/** Nom de la base réellement connectée, selon PostgreSQL. */
export async function currentDatabaseName(db: Database): Promise<string | null> {
  const result = await db.execute<{ name: string }>(sql`select current_database() as name`);
  // `db.execute` renvoie `{ rows }` : node-postgres et PGlite ont la même forme.
  return (result as unknown as { rows: { name: string }[] }).rows[0]?.name ?? null;
}

/** Fiches du jeu staging présentes en base, pour un contrôle rapide après coup. */
export async function countStagingCompanies(db: Database, prefix: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.companies)
    .where(like(s.companies.twentyId, `${prefix}%`));
  return rows[0]?.count ?? 0;
}

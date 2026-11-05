import { asc, getTableColumns, gt } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "@/lib/zod";
import { recordAudit } from "@/modules/audit/audit.service";
import { escapeCsvCell } from "@/modules/finance/finance.csv";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { parseInput } from "@/server/validation";

/**
 * Réversibilité (écran 24) : les données métier, en CSV par jeu ou en JSON. Une lecture transversale
 * de lecture seule : c'est le seul endroit qui lit les tables de tous les domaines, et il n'y a que
 * les tables de cette liste. Jamais les comptes d'authentification, les sessions, les secrets
 * 2FA, les vérifications ni la boîte d'envoi, qui porte des liens de connexion.
 */
const NEVER_EXPORTED = /password|secret|token|hash|storage_?key|backup_?codes|ban_?reason/i;
const BATCH_SIZE = 500;

const DATASETS = {
  clients: { label: "Clients", table: schema.companies },
  contacts: { label: "Contacts", table: schema.contacts },
  affaires: { label: "Affaires", table: schema.opportunities },
  activites: { label: "Activités", table: schema.activities },
  catalogue: { label: "Catalogue", table: schema.catalogItems },
  devis: { label: "Devis", table: schema.quotes },
  "devis-versions": { label: "Versions des devis", table: schema.quoteVersions },
  "devis-lignes": { label: "Lignes des devis", table: schema.quoteLines },
  projets: { label: "Projets", table: schema.projects },
  jalons: { label: "Jalons", table: schema.projectPhases },
  taches: { label: "Tâches", table: schema.tasks },
  livrables: { label: "Livrables", table: schema.deliverables },
  "demandes-changement": { label: "Demandes de changement", table: schema.changeRequests },
  membres: { label: "Membres de l'équipe", table: schema.teamMembers },
  missions: { label: "Missions", table: schema.missions },
  temps: { label: "Temps passés", table: schema.timeEntries },
  sites: { label: "Sites", table: schema.sites },
  domaines: { label: "Domaines", table: schema.domains },
  deploiements: { label: "Déploiements", table: schema.deployments },
  formules: { label: "Formules", table: schema.maintenancePlans },
  contrats: { label: "Contrats", table: schema.contracts },
  interventions: { label: "Interventions", table: schema.maintenanceInterventions },
  demandes: { label: "Demandes de support", table: schema.tickets },
  "demandes-messages": { label: "Messages des demandes", table: schema.ticketMessages },
  factures: { label: "Factures", table: schema.financialDocuments },
  echeances: { label: "Échéances", table: schema.paymentScheduleItems },
  couts: { label: "Coûts directs", table: schema.directCosts },
  documents: { label: "Documents (références)", table: schema.documents },
  connaissances: { label: "Articles", table: schema.knowledgeArticles },
  modeles: { label: "Modèles", table: schema.templates },
  conversations: { label: "Conversations", table: schema.conversations },
  messages: { label: "Messages", table: schema.messages },
  commentaires: { label: "Commentaires", table: schema.comments },
  "rendez-vous": { label: "Rendez-vous", table: schema.appointments },
  journal: { label: "Journal d'audit", table: schema.auditLog },
} as const satisfies Record<string, { label: string; table: PgTable }>;

export type ExportDataset = keyof typeof DATASETS;

export const EXPORT_DATASETS = (Object.keys(DATASETS) as ExportDataset[]).map((key) => ({
  key,
  label: DATASETS[key].label,
}));

/** Comptes : colonnes choisies une à une, sans rien de l'authentification. */
const USER_COLUMNS = {
  id: schema.users.id,
  name: schema.users.name,
  email: schema.users.email,
  role: schema.users.role,
  banned: schema.users.banned,
  twoFactorEnabled: schema.users.twoFactorEnabled,
  createdAt: schema.users.createdAt,
};

const exportQuerySchema = z.object({
  jeu: z.enum(["tout", "comptes", ...(Object.keys(DATASETS) as ExportDataset[])]),
  format: z.enum(["json", "csv"]),
});

function columnsOf(table: PgTable): Record<string, PgColumn> {
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  return Object.fromEntries(
    Object.entries(columns).filter(
      ([key, column]) => !NEVER_EXPORTED.test(key) && !NEVER_EXPORTED.test(column.name),
    ),
  );
}

/** Lecture par lots, sur l'identifiant : un gros jeu ne se charge jamais d'un seul bloc. */
async function* readRows(
  db: Database,
  table: PgTable,
  columns: Record<string, PgColumn>,
): AsyncGenerator<Record<string, unknown>[]> {
  const id = (getTableColumns(table) as Record<string, PgColumn>).id;
  if (!id) throw new Error("Jeu d'export sans identifiant.");
  let last: string | null = null;
  for (;;) {
    const rows: Record<string, unknown>[] = await db
      .select({ ...columns, __id: id })
      .from(table as never)
      .where(last ? gt(id, last) : undefined)
      .orderBy(asc(id))
      .limit(BATCH_SIZE);
    if (rows.length === 0) return;
    yield rows.map(({ __id: _id, ...row }) => row);
    last = rows.at(-1)?.__id as string;
    if (rows.length < BATCH_SIZE) return;
  }
}

function csvValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sourceOf(jeu: string): { table: PgTable; columns: Record<string, PgColumn> } {
  if (jeu === "comptes") return { table: schema.users, columns: USER_COLUMNS };
  const dataset = DATASETS[jeu as ExportDataset];
  return { table: dataset.table, columns: columnsOf(dataset.table) };
}

async function* csvChunks(db: Database, jeu: string): AsyncGenerator<string> {
  const { table, columns } = sourceOf(jeu);
  const headers = Object.keys(columns);
  yield `﻿${headers.map(escapeCsvCell).join(";")}\r\n`;
  for await (const rows of readRows(db, table, columns)) {
    yield rows
      .map((row) => `${headers.map((key) => escapeCsvCell(csvValue(row[key]))).join(";")}\r\n`)
      .join("");
  }
}

async function* jsonOfDataset(db: Database, jeu: string): AsyncGenerator<string> {
  const { table, columns } = sourceOf(jeu);
  yield "[";
  let first = true;
  for await (const rows of readRows(db, table, columns)) {
    for (const row of rows) {
      yield `${first ? "" : ","}${JSON.stringify(row)}`;
      first = false;
    }
  }
  yield "]";
}

async function* jsonChunks(db: Database, jeu: string): AsyncGenerator<string> {
  if (jeu !== "tout") {
    yield* jsonOfDataset(db, jeu);
    return;
  }
  const keys = ["comptes", ...Object.keys(DATASETS)];
  yield `{"exportedAt":${JSON.stringify(new Date().toISOString())}`;
  for (const key of keys) {
    yield `,${JSON.stringify(key)}:`;
    yield* jsonOfDataset(db, key);
  }
  yield "}";
}

export interface ExportStream {
  filename: string;
  contentType: string;
  chunks: AsyncGenerator<string>;
}

/** Journalisé avant la première ligne : une sortie de données ne reste jamais sans trace. */
export async function startExport(ctx: ServiceContext, rawQuery: unknown): Promise<ExportStream> {
  assertCan(ctx.actor, "export:run");
  const query = parseInput(exportQuerySchema, rawQuery);
  // Le CSV n'a qu'un tableau par fichier : l'export complet se fait en JSON.
  const format = query.jeu === "tout" ? "json" : query.format;
  await recordAudit(ctx.db, {
    actorId: ctx.actor.userId,
    action: "export.run",
    entityType: "export",
    metadata: { dataset: query.jeu, format },
  });
  const day = new Date().toISOString().slice(0, 10);
  return {
    filename: `nuera-${query.jeu}-${day}.${format}`,
    contentType: format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
    chunks: format === "json" ? jsonChunks(ctx.db, query.jeu) : csvChunks(ctx.db, query.jeu),
  };
}

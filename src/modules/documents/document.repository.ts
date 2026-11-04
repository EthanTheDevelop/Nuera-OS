import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  notInArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  companies,
  contracts,
  documents,
  documentVersions,
  projects,
  quotes,
  sites,
  tickets,
  users,
  type Document,
  type DocumentVersion,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { paginate, prefixTsQuery, type PageParams, type Paginated } from "@/server/pagination";
import { COMMERCIAL_DOCUMENT_KINDS } from "./document.format";
import type { CompanyLinkOptions, DocumentRow, DocumentVersionRow } from "./document.types";

const ACCENTS = "àâäáãéèêëíîïìóôöòõúûüùçñÀÂÄÁÃÉÈÊËÍÎÏÌÓÔÖÒÕÚÛÜÙÇÑ";
const PLAIN = "aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN";

const stripAccents = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "");

/**
 * Recherche par préfixes sur plusieurs colonnes, éventuellement jointes : « atelier 2026 » trouve
 * un document dont le client est « Atelier Lune » et le projet « P-2026-007 ». Insensible aux
 * accents. Partagée par les documents, les modèles et les articles.
 */
export function matchesSearch(
  columns: readonly SQLWrapper[],
  search: string | null | undefined,
): SQL | undefined {
  const query = prefixTsQuery(stripAccents(search ?? ""));
  if (!query) return undefined;
  const text = sql.join(
    columns.map((column) => sql`coalesce(${column}, '')`),
    sql` || ' ' || `,
  );
  return sql`to_tsvector('simple', translate(replace(${text}, '-', ' '), ${ACCENTS}, ${PLAIN})) @@ to_tsquery('simple', ${query})`;
}

/**
 * Périmètre de lecture, appliqué dans chaque requête : l'équipe voit tout, un prestataire les
 * documents de ses projets et de ses demandes, un client ceux partagés avec son entreprise.
 */
export type DocumentScope =
  | { kind: "all" }
  | { kind: "assigned"; projectIds: string[]; memberId: string | null }
  | { kind: "portal"; companyId: string };

function scopeCondition(scope: DocumentScope): SQL | undefined {
  if (scope.kind === "all") return undefined;
  if (scope.kind === "portal") {
    return and(
      eq(documents.companyId, scope.companyId),
      eq(documents.visibility, "client"),
      isNull(documents.archivedAt),
      isNotNull(documents.currentVersionId),
    );
  }
  if (scope.projectIds.length === 0 && !scope.memberId) return sql`false`;
  return and(
    or(
      scope.projectIds.length > 0 ? inArray(documents.projectId, scope.projectIds) : undefined,
      scope.memberId
        ? sql`${documents.ticketId} in (select ${tickets.id} from ${tickets} where ${tickets.assigneeMemberId} = ${scope.memberId} and ${tickets.archivedAt} is null)`
        : undefined,
    ),
    isNull(documents.archivedAt),
    // Un prestataire n'a ni `quotes:read`, ni `contracts:read`, ni `finance:read`.
    notInArray(documents.kind, [...COMMERCIAL_DOCUMENT_KINDS]),
    isNull(documents.contractId),
    isNull(documents.quoteId),
  );
}

const currentVersion = aliasedTable(documentVersions, "current_version");

const rowColumns = {
  id: documents.id,
  title: documents.title,
  kind: documents.kind,
  visibility: documents.visibility,
  status: documents.status,
  uploadedByClient: documents.uploadedByClient,
  archivedAt: documents.archivedAt,
  updatedAt: documents.updatedAt,
  companyId: documents.companyId,
  companyName: companies.name,
  projectId: documents.projectId,
  projectNumber: projects.number,
  projectName: projects.name,
  contractId: documents.contractId,
  contractNumber: contracts.number,
  contractName: contracts.name,
  siteId: documents.siteId,
  siteName: sites.name,
  ticketId: documents.ticketId,
  ticketNumber: tickets.number,
  quoteId: documents.quoteId,
  quoteNumber: quotes.number,
  currentVersionId: documents.currentVersionId,
  version: currentVersion.version,
  versionCount: sql<number>`(select count(*)::int from ${documentVersions} where ${documentVersions.documentId} = ${documents.id})`,
  filename: currentVersion.filename,
  mimeType: currentVersion.mimeType,
  sizeBytes: currentVersion.sizeBytes,
};

/** Le client, le projet, le contrat… qui servent à l'affichage et à la recherche. */
function withLinks(db: Database) {
  return db
    .select(rowColumns)
    .from(documents)
    .leftJoin(companies, eq(documents.companyId, companies.id))
    .leftJoin(projects, eq(documents.projectId, projects.id))
    .leftJoin(contracts, eq(documents.contractId, contracts.id))
    .leftJoin(sites, eq(documents.siteId, sites.id))
    .leftJoin(tickets, eq(documents.ticketId, tickets.id))
    .leftJoin(quotes, eq(documents.quoteId, quotes.id))
    .leftJoin(currentVersion, eq(documents.currentVersionId, currentVersion.id));
}

export interface DocumentQuery {
  scope: DocumentScope;
  search?: string | null;
  companyId?: string | null;
  projectId?: string | null;
  contractId?: string | null;
  siteId?: string | null;
  ticketId?: string | null;
  quoteId?: string | null;
  kind?: Document["kind"] | null;
  kinds?: Document["kind"][];
  visibility?: Document["visibility"] | null;
  uploadedByClient?: boolean;
  archived?: boolean;
}

function queryCondition(query: DocumentQuery): SQL | undefined {
  return and(
    scopeCondition(query.scope),
    query.archived ? isNotNull(documents.archivedAt) : isNull(documents.archivedAt),
    query.companyId ? eq(documents.companyId, query.companyId) : undefined,
    query.projectId ? eq(documents.projectId, query.projectId) : undefined,
    query.contractId ? eq(documents.contractId, query.contractId) : undefined,
    query.siteId ? eq(documents.siteId, query.siteId) : undefined,
    query.ticketId ? eq(documents.ticketId, query.ticketId) : undefined,
    query.quoteId ? eq(documents.quoteId, query.quoteId) : undefined,
    query.kind ? eq(documents.kind, query.kind) : undefined,
    query.kinds?.length ? inArray(documents.kind, query.kinds) : undefined,
    query.visibility ? eq(documents.visibility, query.visibility) : undefined,
    query.uploadedByClient === undefined
      ? undefined
      : eq(documents.uploadedByClient, query.uploadedByClient),
    matchesSearch(
      [
        documents.title,
        companies.name,
        projects.number,
        projects.name,
        contracts.number,
        contracts.name,
        sites.name,
        tickets.number,
        quotes.number,
        currentVersion.filename,
      ],
      query.search,
    ),
  );
}

export async function listDocuments(
  db: Database,
  query: DocumentQuery,
  params: PageParams,
): Promise<Paginated<DocumentRow>> {
  const where = queryCondition(query);
  return paginate(params, {
    items: (limit, offset) =>
      withLinks(db)
        .where(where)
        .orderBy(desc(documents.updatedAt), asc(documents.id))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ value: count() })
        .from(documents)
        .leftJoin(companies, eq(documents.companyId, companies.id))
        .leftJoin(projects, eq(documents.projectId, projects.id))
        .leftJoin(contracts, eq(documents.contractId, contracts.id))
        .leftJoin(sites, eq(documents.siteId, sites.id))
        .leftJoin(tickets, eq(documents.ticketId, tickets.id))
        .leftJoin(quotes, eq(documents.quoteId, quotes.id))
        .leftJoin(currentVersion, eq(documents.currentVersionId, currentVersion.id))
        .where(where);
      return row?.value ?? 0;
    },
  });
}

export async function findDocument(
  db: Database,
  id: string,
  scope: DocumentScope,
): Promise<Document | null> {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), scopeCondition(scope)))
    .limit(1);
  return row ?? null;
}

export async function findDocumentRow(
  db: Database,
  id: string,
  scope: DocumentScope,
): Promise<DocumentRow | null> {
  const [row] = await withLinks(db)
    .where(and(eq(documents.id, id), scopeCondition(scope)))
    .limit(1);
  return row ?? null;
}

export async function lockDocument(tx: Database, id: string): Promise<Document | null> {
  const [row] = await tx
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function insertDocument(
  tx: Database,
  values: typeof documents.$inferInsert,
): Promise<Document> {
  const [row] = await tx.insert(documents).values(values).returning();
  if (!row) throw new Error("Document non créé");
  return row;
}

export async function updateDocument(
  tx: Database,
  id: string,
  patch: Partial<typeof documents.$inferInsert>,
): Promise<Document> {
  const [row] = await tx
    .update(documents)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(documents.id, id))
    .returning();
  if (!row) throw new Error("Document non modifié");
  return row;
}

export async function insertVersion(
  tx: Database,
  values: typeof documentVersions.$inferInsert,
): Promise<DocumentVersion> {
  const [row] = await tx.insert(documentVersions).values(values).returning();
  if (!row) throw new Error("Version non créée");
  return row;
}

export async function nextVersionNumber(tx: Database, documentId: string): Promise<number> {
  const [row] = await tx
    .select({ value: max(documentVersions.version) })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId));
  return (row?.value ?? 0) + 1;
}

export async function findVersionById(
  db: Database,
  documentId: string,
  versionId: string,
): Promise<DocumentVersion | null> {
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.id, versionId)))
    .limit(1);
  return row ?? null;
}

export async function findVersionByNumber(
  db: Database,
  documentId: string,
  version: number,
): Promise<DocumentVersion | null> {
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.version, version)))
    .limit(1);
  return row ?? null;
}

export async function findCurrentVersion(
  db: Database,
  document: Pick<Document, "id" | "currentVersionId">,
): Promise<DocumentVersion | null> {
  return document.currentVersionId
    ? findVersionById(db, document.id, document.currentVersionId)
    : null;
}

export async function findVersionByStorageKey(
  db: Database,
  storageKey: string,
): Promise<DocumentVersion | null> {
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.storageKey, storageKey))
    .limit(1);
  return row ?? null;
}

export async function listVersions(
  db: Database,
  documentId: string,
): Promise<DocumentVersionRow[]> {
  return db
    .select({
      id: documentVersions.id,
      version: documentVersions.version,
      filename: documentVersions.filename,
      mimeType: documentVersions.mimeType,
      sizeBytes: documentVersions.sizeBytes,
      sha256: documentVersions.sha256,
      note: documentVersions.note,
      authorName: users.name,
      createdAt: documentVersions.createdAt,
    })
    .from(documentVersions)
    .leftJoin(users, eq(documentVersions.uploadedByUserId, users.id))
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.version));
}

/** Verrou le temps de la transaction : deux dépôts identiques simultanés ne créent qu'un document. */
export async function lockIdempotencyKey(tx: Database, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

function equalsOrNull(column: AnyPgColumn, value: string | null | undefined): SQL {
  return value ? eq(column, value) : isNull(column);
}

/** Même titre, mêmes rattachements, même contenu : le dépôt a déjà eu lieu. */
export async function findIdenticalDocument(
  db: Database,
  input: {
    title: string;
    sha256: string;
    uploadedByClient: boolean;
    companyId?: string | null;
    projectId?: string | null;
    contractId?: string | null;
    siteId?: string | null;
    ticketId?: string | null;
    quoteId?: string | null;
  },
): Promise<{ document: Document; version: DocumentVersion } | null> {
  const [row] = await db
    .select({ document: documents, version: documentVersions })
    .from(documents)
    .innerJoin(documentVersions, eq(documents.currentVersionId, documentVersions.id))
    .where(
      and(
        eq(documents.title, input.title),
        eq(documentVersions.sha256, input.sha256),
        eq(documents.uploadedByClient, input.uploadedByClient),
        isNull(documents.archivedAt),
        equalsOrNull(documents.companyId, input.companyId),
        equalsOrNull(documents.projectId, input.projectId),
        equalsOrNull(documents.contractId, input.contractId),
        equalsOrNull(documents.siteId, input.siteId),
        equalsOrNull(documents.ticketId, input.ticketId),
        equalsOrNull(documents.quoteId, input.quoteId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function isCompanyActive(db: Database, companyId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), isNull(companies.archivedAt)))
    .limit(1);
  return Boolean(row);
}

export interface LinkIds {
  projectId?: string | null;
  contractId?: string | null;
  siteId?: string | null;
  ticketId?: string | null;
  quoteId?: string | null;
}

/** Client de chaque objet demandé. Un objet inconnu ou archivé n'apparaît pas. */
export async function findLinkCompanies(
  db: Database,
  ids: LinkIds,
): Promise<Record<string, string>> {
  const lookups: Promise<[string, string | null]>[] = [];

  function lookup(field: string, query: Promise<{ companyId: string | null }[]>) {
    lookups.push(query.then(([row]) => [field, row?.companyId ?? null]));
  }

  if (ids.projectId) {
    lookup(
      "projectId",
      db
        .select({ companyId: projects.companyId })
        .from(projects)
        .where(and(eq(projects.id, ids.projectId), isNull(projects.archivedAt)))
        .limit(1),
    );
  }
  if (ids.contractId) {
    lookup(
      "contractId",
      db
        .select({ companyId: contracts.companyId })
        .from(contracts)
        .where(and(eq(contracts.id, ids.contractId), isNull(contracts.archivedAt)))
        .limit(1),
    );
  }
  if (ids.siteId) {
    lookup(
      "siteId",
      db
        .select({ companyId: sites.companyId })
        .from(sites)
        .where(and(eq(sites.id, ids.siteId), isNull(sites.archivedAt)))
        .limit(1),
    );
  }
  if (ids.ticketId) {
    lookup(
      "ticketId",
      db
        .select({ companyId: tickets.companyId })
        .from(tickets)
        .where(and(eq(tickets.id, ids.ticketId), isNull(tickets.archivedAt)))
        .limit(1),
    );
  }
  if (ids.quoteId) {
    lookup(
      "quoteId",
      db
        .select({ companyId: quotes.companyId })
        .from(quotes)
        .where(and(eq(quotes.id, ids.quoteId), isNull(quotes.archivedAt)))
        .limit(1),
    );
  }

  const results = await Promise.all(lookups);
  return Object.fromEntries(
    results.filter((entry): entry is [string, string] => entry[1] !== null),
  );
}

const OPTION_LIMIT = 200;

export async function listCompanyLinkOptions(
  db: Database,
  companyId: string,
): Promise<CompanyLinkOptions> {
  const [projectRows, contractRows, siteRows, ticketRows, quoteRows] = await Promise.all([
    db
      .select({ id: projects.id, number: projects.number, name: projects.name })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), isNull(projects.archivedAt)))
      .orderBy(desc(projects.createdAt))
      .limit(OPTION_LIMIT),
    db
      .select({ id: contracts.id, number: contracts.number, name: contracts.name })
      .from(contracts)
      .where(and(eq(contracts.companyId, companyId), isNull(contracts.archivedAt)))
      .orderBy(desc(contracts.createdAt))
      .limit(OPTION_LIMIT),
    db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.companyId, companyId), isNull(sites.archivedAt)))
      .orderBy(asc(sites.name))
      .limit(OPTION_LIMIT),
    db
      .select({ id: tickets.id, number: tickets.number, subject: tickets.subject })
      .from(tickets)
      .where(and(eq(tickets.companyId, companyId), isNull(tickets.archivedAt)))
      .orderBy(desc(tickets.createdAt))
      .limit(OPTION_LIMIT),
    db
      .select({ id: quotes.id, number: quotes.number, title: quotes.title })
      .from(quotes)
      .where(and(eq(quotes.companyId, companyId), isNull(quotes.archivedAt)))
      .orderBy(desc(quotes.createdAt))
      .limit(OPTION_LIMIT),
  ]);
  return {
    projects: projectRows.map((row) => ({ id: row.id, label: `${row.number} · ${row.name}` })),
    contracts: contractRows.map((row) => ({ id: row.id, label: `${row.number} · ${row.name}` })),
    sites: siteRows.map((row) => ({ id: row.id, label: row.name })),
    tickets: ticketRows.map((row) => ({ id: row.id, label: `${row.number} · ${row.subject}` })),
    quotes: quoteRows.map((row) => ({
      id: row.id,
      label: row.title ? `${row.number} · ${row.title}` : row.number,
    })),
  };
}

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { INTERNAL_ROLES } from "@/server/auth/roles";
import {
  appSettings,
  companies,
  contacts,
  conversations,
  documents,
  documentVersions,
  messages,
  projects,
  replySuggestions,
  users,
  type ReplySuggestion,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { pageOffset, paginated, type PageParams, type Paginated } from "@/server/pagination";
import type { InboxFilter } from "./messaging.schema";

const CLIENT_STATUSES = ["client", "subscriber"] as const;

/** Une saisie ne doit pas jouer le rôle de joker dans un `ILIKE`. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Sous-requêtes corrélées écrites avec des identifiants littéraux : `sql` n'y qualifierait pas les
 * colonnes du `from` dans une requête sans jointure.
 */
const LAST_BODY = sql<string | null>`(
  select m.body from messages m
  where m.conversation_id = "conversations"."id"
  order by m.at desc, m.id desc limit 1
)`;
const LAST_DIRECTION = sql<"inbound" | "outbound" | "internal" | null>`(
  select m.direction from messages m
  where m.conversation_id = "conversations"."id"
  order by m.at desc, m.id desc limit 1
)`;
/** Dernier échange avec le client : une note interne n'y répond pas. */
const LAST_EXCHANGE_BODY = sql<string | null>`(
  select m.body from messages m
  where m.conversation_id = "conversations"."id" and m.direction <> 'internal'
  order by m.at desc, m.id desc limit 1
)`;
const LAST_EXCHANGE_DIRECTION = sql<"inbound" | "outbound" | null>`(
  select m.direction from messages m
  where m.conversation_id = "conversations"."id" and m.direction <> 'internal'
  order by m.at desc, m.id desc limit 1
)`;
const HAS_READY_SUGGESTION = sql<boolean>`exists (
  select 1 from reply_suggestions s
  where s.conversation_id = "conversations"."id" and s.status = 'ready'
)`;

const CONVERSATION_FIELDS = {
  id: conversations.id,
  companyId: conversations.companyId,
  companyName: companies.name,
  companyStatus: companies.status,
  companyActivity: companies.activity,
  contactId: conversations.contactId,
  contactFirstName: contacts.firstName,
  contactLastName: contacts.lastName,
  projectId: conversations.projectId,
  projectName: projects.name,
  projectActivity: projects.activity,
  projectStepLabel: projects.clientStepLabel,
  subject: conversations.subject,
  lastMessageAt: conversations.lastMessageAt,
  unreadInternal: conversations.unreadInternal,
  unreadClient: conversations.unreadClient,
  archivedAt: conversations.archivedAt,
  lastBody: LAST_BODY,
  lastDirection: LAST_DIRECTION,
  hasReadySuggestion: HAS_READY_SUGGESTION,
};

export type ConversationRow = Awaited<ReturnType<typeof findConversation>> & object;

function conversationQuery(db: Database, lastBody: typeof LAST_BODY = LAST_BODY) {
  return db
    .select({ ...CONVERSATION_FIELDS, lastBody })
    .from(conversations)
    .innerJoin(companies, eq(conversations.companyId, companies.id))
    .leftJoin(contacts, eq(conversations.contactId, contacts.id))
    .leftJoin(projects, eq(conversations.projectId, projects.id));
}

function inboxWhere(options: { filter?: InboxFilter; search?: string }): SQL | undefined {
  const search = options.search?.trim();
  const pattern = search ? likePattern(search) : null;
  return and(
    options.filter === "archivees"
      ? isNotNull(conversations.archivedAt)
      : isNull(conversations.archivedAt),
    options.filter === "clients" ? inArray(companies.status, [...CLIENT_STATUSES]) : undefined,
    options.filter === "prospects" ? eq(companies.status, "prospect") : undefined,
    options.filter === "pretes" ? HAS_READY_SUGGESTION : undefined,
    pattern
      ? or(
          sql`${companies.name} ilike ${pattern}`,
          sql`${conversations.subject} ilike ${pattern}`,
          sql`${contacts.firstName} || ' ' || ${contacts.lastName} ilike ${pattern}`,
          sql`exists (
            select 1 from messages m
            where m.conversation_id = "conversations"."id" and m.body ilike ${pattern}
          )`,
        )
      : undefined,
  );
}

// --- Rattachements et comptes -------------------------------------------------------------------

export async function findActiveCompanyId(db: Database, id: string): Promise<string | null> {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, id), isNull(companies.archivedAt)))
    .limit(1);
  return row?.id ?? null;
}

export async function isActiveContactOfCompany(
  db: Database,
  contactId: string,
  companyId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.companyId, companyId),
        isNull(contacts.archivedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function isProjectOfCompany(
  db: Database,
  projectId: string,
  companyId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)))
    .limit(1);
  return Boolean(row);
}

export async function findUserRole(db: Database, userId: string) {
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.role ?? null;
}

/** Comptes actifs de l'équipe parmi ces identifiants, sous la forme d'un acteur. */
export async function findInternalUsers(db: Database, ids: readonly string[]) {
  return db
    .select({ userId: users.id, role: users.role, name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        inArray(users.id, [...ids]),
        inArray(users.role, [...INTERNAL_ROLES]),
        eq(users.banned, false),
      ),
    );
}

// --- Boîte ---------------------------------------------------------------------------------------

export async function listConversations(
  db: Database,
  options: { filter?: InboxFilter; search?: string },
  params: PageParams,
): Promise<Paginated<ConversationRow>> {
  const where = inboxWhere(options);
  const [items, countRows] = await Promise.all([
    conversationQuery(db)
      .where(where)
      .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.id))
      .limit(params.pageSize)
      .offset(pageOffset(params)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(conversations)
      .innerJoin(companies, eq(conversations.companyId, companies.id))
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(where),
  ]);
  return paginated(items, countRows[0]?.total ?? 0, params);
}

/** Compteurs des filtres de la boîte, indépendants du filtre actif. */
export async function countInbox(db: Database) {
  const active = isNull(conversations.archivedAt);
  const [row] = await db
    .select({
      all: sql<number>`count(*) filter (where ${active})::int`,
      clients: sql<number>`count(*) filter (where ${and(active, inArray(companies.status, [...CLIENT_STATUSES]))})::int`,
      prospects: sql<number>`count(*) filter (where ${and(active, eq(companies.status, "prospect"))})::int`,
      ready: sql<number>`count(*) filter (where ${and(active, HAS_READY_SUGGESTION)})::int`,
      archived: sql<number>`count(*) filter (where ${isNotNull(conversations.archivedAt)})::int`,
      unread: sql<number>`coalesce(sum(${conversations.unreadInternal}) filter (where ${active}), 0)::int`,
    })
    .from(conversations)
    .innerJoin(companies, eq(conversations.companyId, companies.id));
  return row ?? { all: 0, clients: 0, prospects: 0, ready: 0, archived: 0, unread: 0 };
}

export async function findConversation(db: Database, id: string) {
  const [row] = await conversationQuery(db).where(eq(conversations.id, id)).limit(1);
  return row ?? null;
}

export async function listConversationsForCompany(
  db: Database,
  companyId: string,
  limit: number,
): Promise<ConversationRow[]> {
  return conversationQuery(db)
    .where(and(eq(conversations.companyId, companyId), isNull(conversations.archivedAt)))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`)
    .limit(limit);
}

/** Conversations qui attendent une réponse : le dernier échange vient du client. */
export async function listAwaitingReply(db: Database, limit: number): Promise<ConversationRow[]> {
  return conversationQuery(db, LAST_EXCHANGE_BODY)
    .where(and(isNull(conversations.archivedAt), sql`${LAST_EXCHANGE_DIRECTION} = 'inbound'`))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`)
    .limit(limit);
}

export async function sumUnreadInternal(db: Database): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${conversations.unreadInternal}), 0)::int` })
    .from(conversations)
    .where(isNull(conversations.archivedAt));
  return row?.total ?? 0;
}

export async function insertConversation(db: Database, values: typeof conversations.$inferInsert) {
  const [row] = await db
    .insert(conversations)
    .values(values)
    .onConflictDoNothing({ target: conversations.id })
    .returning({ id: conversations.id });
  return row ?? null;
}

export async function archiveConversation(db: Database, id: string, at: Date): Promise<void> {
  await db
    .update(conversations)
    .set({ archivedAt: at })
    .where(and(eq(conversations.id, id), isNull(conversations.archivedAt)));
}

export async function restoreConversation(db: Database, id: string): Promise<void> {
  await db.update(conversations).set({ archivedAt: null }).where(eq(conversations.id, id));
}

/** Réservé à l'équipe. Sans ligne non lue, n'écrit rien : la répétition ne coûte rien. */
export async function markInternalRead(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .update(conversations)
    .set({ unreadInternal: 0 })
    .where(and(eq(conversations.id, id), gt(conversations.unreadInternal, 0)))
    .returning({ id: conversations.id });
  return rows.length > 0;
}

/** Met à jour la conversation qui reçoit un message : date, et non-lus du côté destinataire. */
export async function touchConversation(
  db: Database,
  id: string,
  at: Date,
  unread: "internal" | "client" | null,
): Promise<void> {
  await db
    .update(conversations)
    .set({
      lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${at.toISOString()}::timestamptz)`,
      ...(unread === "internal"
        ? { unreadInternal: sql`${conversations.unreadInternal} + 1` }
        : {}),
      ...(unread === "client" ? { unreadClient: sql`${conversations.unreadClient} + 1` } : {}),
    })
    .where(eq(conversations.id, id));
}

export async function insertMessage(db: Database, values: typeof messages.$inferInsert) {
  const [row] = await db
    .insert(messages)
    .values(values)
    .onConflictDoNothing({ target: messages.id })
    .returning();
  return row ?? null;
}

const MESSAGE_FIELDS = {
  id: messages.id,
  conversationId: messages.conversationId,
  direction: messages.direction,
  body: messages.body,
  mentions: messages.mentions,
  at: messages.at,
  authorUserId: messages.authorUserId,
  authorUserName: users.name,
  authorContactId: messages.authorContactId,
  authorFirstName: contacts.firstName,
  authorLastName: contacts.lastName,
  documentId: documents.id,
  documentTitle: documents.title,
  documentVisibility: documents.visibility,
  documentFilename: documentVersions.filename,
  documentMimeType: documentVersions.mimeType,
  documentSizeBytes: documentVersions.sizeBytes,
};

export type MessageRow = Awaited<ReturnType<typeof findMessage>> & object;

function messageQuery(db: Database) {
  return db
    .select(MESSAGE_FIELDS)
    .from(messages)
    .leftJoin(users, eq(messages.authorUserId, users.id))
    .leftJoin(contacts, eq(messages.authorContactId, contacts.id))
    .leftJoin(documents, and(eq(messages.documentId, documents.id), isNull(documents.archivedAt)))
    .leftJoin(documentVersions, eq(documents.currentVersionId, documentVersions.id));
}

export async function findMessage(db: Database, id: string) {
  const [row] = await messageQuery(db).where(eq(messages.id, id)).limit(1);
  return row ?? null;
}

/**
 * Curseur `(at, id)`, du plus récent au plus ancien : `before` désigne le plus ancien déjà affiché.
 * Une page de plus que demandé indique s'il en reste.
 */
export async function listMessages(
  db: Database,
  conversationId: string,
  options: { before?: Date; beforeId?: string; limit: number },
): Promise<{ items: MessageRow[]; hasMore: boolean }> {
  const rows = await messageQuery(db)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        options.before && options.beforeId
          ? or(
              lt(messages.at, options.before),
              and(eq(messages.at, options.before), lt(messages.id, options.beforeId)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(messages.at), desc(messages.id))
    .limit(options.limit + 1);
  const hasMore = rows.length > options.limit;
  return { items: rows.slice(0, options.limit).reverse(), hasMore };
}

export async function findLatestInbound(db: Database, conversationId: string) {
  const [row] = await db
    .select({ id: messages.id, body: messages.body })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "inbound")))
    .orderBy(desc(messages.at), desc(messages.id))
    .limit(1);
  return row ?? null;
}

/** Dernier échange avec le client, quel que soit son sens : ce que la génération doit voir inchangé. */
export async function findLatestExchangeId(
  db: Database,
  conversationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), ne(messages.direction, "internal")))
    .orderBy(desc(messages.at), desc(messages.id))
    .limit(1);
  return row?.id ?? null;
}

// --- Portail -----------------------------------------------------------------------------------

/**
 * Cloisonnement du portail : les conversations de son client, adressées à ce contact ou à personne
 * en particulier. Toute lecture et toute écriture du portail passent par cette condition.
 */
function portalScope(companyId: string, contactId: string): SQL {
  return and(
    eq(conversations.companyId, companyId),
    isNull(conversations.archivedAt),
    or(isNull(conversations.contactId), eq(conversations.contactId, contactId)),
  ) as SQL;
}

/** Fil du portail : jamais de note interne, jamais de pièce jointe non partagée au client. */
export async function listPortalMessages(
  db: Database,
  scope: { companyId: string; contactId: string },
  options: { before?: Date; beforeId?: string; limit: number },
) {
  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      direction: messages.direction,
      body: messages.body,
      at: messages.at,
      authorContactId: messages.authorContactId,
      authorUserName: users.name,
      authorFirstName: contacts.firstName,
      authorLastName: contacts.lastName,
      documentId: documents.id,
      documentTitle: documents.title,
      documentFilename: documentVersions.filename,
      documentMimeType: documentVersions.mimeType,
      documentSizeBytes: documentVersions.sizeBytes,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .leftJoin(users, eq(messages.authorUserId, users.id))
    .leftJoin(contacts, eq(messages.authorContactId, contacts.id))
    .leftJoin(
      documents,
      and(
        eq(messages.documentId, documents.id),
        eq(documents.companyId, scope.companyId),
        eq(documents.visibility, "client"),
        isNull(documents.archivedAt),
      ),
    )
    .leftJoin(documentVersions, eq(documents.currentVersionId, documentVersions.id))
    .where(
      and(
        portalScope(scope.companyId, scope.contactId),
        ne(messages.direction, "internal"),
        options.before && options.beforeId
          ? or(
              lt(messages.at, options.before),
              and(eq(messages.at, options.before), lt(messages.id, options.beforeId)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(messages.at), desc(messages.id))
    .limit(options.limit + 1);
  const hasMore = rows.length > options.limit;
  return { items: rows.slice(0, options.limit).reverse(), hasMore };
}

/** Conversation qui reçoit les messages du portail : la plus récente de son périmètre. */
export async function findPortalConversationId(
  db: Database,
  scope: { companyId: string; contactId: string },
): Promise<string | null> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(portalScope(scope.companyId, scope.contactId))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export async function sumPortalUnread(
  db: Database,
  scope: { companyId: string; contactId: string },
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${conversations.unreadClient}), 0)::int` })
    .from(conversations)
    .where(portalScope(scope.companyId, scope.contactId));
  return row?.total ?? 0;
}

export async function markPortalRead(
  db: Database,
  scope: { companyId: string; contactId: string },
): Promise<number> {
  const rows = await db
    .update(conversations)
    .set({ unreadClient: 0 })
    .where(and(portalScope(scope.companyId, scope.contactId), gt(conversations.unreadClient, 0)))
    .returning({ id: conversations.id });
  return rows.length;
}

// --- Suggestions -------------------------------------------------------------------------------

export async function readSetting(db: Database, key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value;
}

export async function writeSetting(
  db: Database,
  key: string,
  value: unknown,
  updatedBy: string,
): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedBy })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy } });
}

export async function findSuggestion(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(replySuggestions)
    .where(eq(replySuggestions.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Suggestion à afficher : la proposition prête, sinon le dernier échec. Un échec de « Reformuler »
 * ne masque pas le texte qu'il devait retravailler : il reste tracé, et signalé à la personne.
 */
export async function findCurrentSuggestion(db: Database, conversationId: string) {
  const [row] = await db
    .select()
    .from(replySuggestions)
    .where(
      and(
        eq(replySuggestions.conversationId, conversationId),
        inArray(replySuggestions.status, ["ready", "failed"]),
      ),
    )
    .orderBy(
      sql`(${replySuggestions.status} = 'ready') desc`,
      desc(replySuggestions.createdAt),
      desc(replySuggestions.id),
    )
    .limit(1);
  return row ?? null;
}

export async function findReadySuggestionForMessage(
  db: Database,
  conversationId: string,
  messageId: string,
) {
  const [row] = await db
    .select()
    .from(replySuggestions)
    .where(
      and(
        eq(replySuggestions.conversationId, conversationId),
        eq(replySuggestions.messageId, messageId),
        eq(replySuggestions.status, "ready"),
      ),
    )
    .orderBy(desc(replySuggestions.createdAt))
    .limit(1);
  return row ?? null;
}

export async function insertSuggestion(db: Database, values: typeof replySuggestions.$inferInsert) {
  const [row] = await db.insert(replySuggestions).values(values).returning();
  if (!row) throw new Error("Suggestion non enregistrée");
  return row;
}

/** Écriture conditionnelle : `false` si la suggestion a changé d'état depuis sa lecture. */
export async function setSuggestionStatus(
  db: Database,
  id: string,
  from: ReplySuggestion["status"],
  status: "used" | "dismissed",
): Promise<boolean> {
  const rows = await db
    .update(replySuggestions)
    .set({ status })
    .where(and(eq(replySuggestions.id, id), eq(replySuggestions.status, from)))
    .returning({ id: replySuggestions.id });
  return rows.length > 0;
}

/** Une réponse envoyée ou un nouveau message rend caduques les suggestions encore ouvertes. */
export async function dismissOpenSuggestions(db: Database, conversationId: string): Promise<void> {
  await db
    .update(replySuggestions)
    .set({ status: "dismissed" })
    .where(
      and(
        eq(replySuggestions.conversationId, conversationId),
        inArray(replySuggestions.status, ["ready", "failed"]),
      ),
    );
}

/** Suggestions de la conversation, de la plus ancienne à la plus récente (contrôle et tests). */
export async function listSuggestions(db: Database, conversationId: string) {
  return db
    .select()
    .from(replySuggestions)
    .where(eq(replySuggestions.conversationId, conversationId))
    .orderBy(asc(replySuggestions.createdAt));
}

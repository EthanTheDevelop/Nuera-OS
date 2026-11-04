import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { companies, contacts, portalMemberships } from "@/server/db/schema";
import type { Contact } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { paginate, prefixTsQuery, type PageParams } from "@/server/pagination";
import { isUuid, rowsOf } from "./company.repository";
import type { ContactDirectoryFilters } from "./crm.schema";

export async function findContactById(db: Database, id: string): Promise<Contact | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return row ?? null;
}

export async function findContactByTwentyId(
  db: Database,
  twentyId: string,
): Promise<Contact | null> {
  const [row] = await db.select().from(contacts).where(eq(contacts.twentyId, twentyId)).limit(1);
  return row ?? null;
}

export async function findContactsByEmail(
  db: Database,
  email: string,
  excludeId?: string,
): Promise<Contact[]> {
  return db
    .select()
    .from(contacts)
    .where(
      and(
        sql`lower(${contacts.email}) = ${email.toLowerCase()}`,
        excludeId ? ne(contacts.id, excludeId) : undefined,
      ),
    )
    .limit(5);
}

export async function insertContact(
  tx: Database,
  values: typeof contacts.$inferInsert,
): Promise<Contact | null> {
  const [row] = await tx.insert(contacts).values(values).onConflictDoNothing().returning();
  return row ?? null;
}

export async function updateContactRow(
  tx: Database,
  id: string,
  values: Partial<typeof contacts.$inferInsert>,
): Promise<Contact> {
  const [row] = await tx.update(contacts).set(values).where(eq(contacts.id, id)).returning();
  if (!row) throw new Error("Contact introuvable au moment de l'écriture");
  return row;
}

/** Un seul contact principal par client. */
export async function clearPrimaryContact(
  tx: Database,
  companyId: string,
  exceptId: string,
): Promise<void> {
  await tx
    .update(contacts)
    .set({ isPrimary: false })
    .where(
      and(
        eq(contacts.companyId, companyId),
        eq(contacts.isPrimary, true),
        ne(contacts.id, exceptId),
      ),
    );
}

export async function listContactsOfCompany(
  db: Database,
  companyId: string,
  options: { limit?: number } = {},
): Promise<Contact[]> {
  return db
    .select()
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), isNull(contacts.archivedAt)))
    .orderBy(desc(contacts.isPrimary), asc(contacts.lastName), asc(contacts.firstName))
    .limit(options.limit ?? 100);
}

function directoryWhere(filters: ContactDirectoryFilters): SQL | undefined {
  const query = prefixTsQuery(filters.q);
  return and(
    filters.archives ? isNotNull(contacts.archivedAt) : isNull(contacts.archivedAt),
    filters.role ? sql`${contacts.roles} @> array[${filters.role}]::text[]` : undefined,
    query
      ? or(
          sql`to_tsvector('simple', ${contacts.firstName} || ' ' || ${contacts.lastName} || ' ' || coalesce(${contacts.email}, '')) @@ to_tsquery('simple', ${query})`,
          sql`to_tsvector('simple', ${companies.name}) @@ to_tsquery('simple', ${query})`,
        )
      : undefined,
  );
}

export async function listContactDirectoryPage(
  db: Database,
  filters: ContactDirectoryFilters,
  params: PageParams,
) {
  const where = directoryWhere(filters);
  return paginate(params, {
    items: (limit, offset) =>
      db
        .select({ contact: contacts, companyName: companies.name })
        .from(contacts)
        .leftJoin(companies, eq(contacts.companyId, companies.id))
        .where(where)
        .orderBy(asc(contacts.lastName), asc(contacts.firstName), asc(contacts.id))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ total: count() })
        .from(contacts)
        .leftJoin(companies, eq(contacts.companyId, companies.id))
        .where(where);
      return row?.total ?? 0;
    },
  });
}

export async function findPortalMembershipForContact(tx: Database, contactId: string) {
  const [row] = await tx
    .select({ id: portalMemberships.id, status: portalMemberships.status })
    .from(portalMemberships)
    .where(eq(portalMemberships.contactId, contactId))
    .limit(1);
  return row ?? null;
}

export async function countActivePortalMemberships(tx: Database, contactIds: string[]) {
  const [row] = await tx
    .select({ total: count() })
    .from(portalMemberships)
    .where(
      and(
        inArray(portalMemberships.contactId, contactIds),
        ne(portalMemberships.status, "revoked"),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Change le client d'un contact : les liens vers ce contact portés par un objet de l'ancien client
 * sont vidés dans la même instruction, sinon les clés composites refuseraient le déplacement.
 * `portal_memberships` n'est pas touchée : l'appelant refuse le déplacement si elle existe.
 */
export async function moveContactToCompany(
  tx: Database,
  contactId: string,
  companyId: string | null,
): Promise<void> {
  await tx.execute(sql`
    with cleared_opportunities as (
      update opportunities set contact_id = null
       where contact_id = ${contactId}::uuid and company_id is distinct from ${companyId}::uuid
    ), cleared_activities as (
      update activities set contact_id = null
       where contact_id = ${contactId}::uuid and company_id is distinct from ${companyId}::uuid
    ), cleared_conversations as (
      update conversations set contact_id = null
       where contact_id = ${contactId}::uuid and company_id is distinct from ${companyId}::uuid
    ), cleared_messages as (
      update messages set author_contact_id = null
       where author_contact_id = ${contactId}::uuid and company_id is distinct from ${companyId}::uuid
    ), cleared_appointments as (
      update appointments set contact_id = null
       where contact_id = ${contactId}::uuid and company_id is distinct from ${companyId}::uuid
    )
    update contacts set company_id = ${companyId}::uuid, updated_at = now() where id = ${contactId}::uuid
  `);
}

/** Fusion de deux contacts d'un même client : tous les liens passent au gagnant, en une instruction. */
export async function moveContactChildren(
  tx: Database,
  loserId: string,
  winnerId: string,
): Promise<void> {
  await tx.execute(sql`
    with moved_opportunities as (
      update opportunities set contact_id = ${winnerId}::uuid where contact_id = ${loserId}::uuid
    ), moved_activities as (
      update activities set contact_id = ${winnerId}::uuid where contact_id = ${loserId}::uuid
    ), moved_conversations as (
      update conversations set contact_id = ${winnerId}::uuid where contact_id = ${loserId}::uuid
    ), moved_messages as (
      update messages set author_contact_id = ${winnerId}::uuid where author_contact_id = ${loserId}::uuid
    ), moved_appointments as (
      update appointments set contact_id = ${winnerId}::uuid where contact_id = ${loserId}::uuid
    ), moved_memberships as (
      update portal_memberships set contact_id = ${winnerId}::uuid where contact_id = ${loserId}::uuid
    )
    update contacts
       set archived_at = coalesce(archived_at, now()), is_primary = false, updated_at = now()
     where id = ${loserId}::uuid
  `);
}

export type ContactDuplicateCandidate = {
  reason: "email" | "phone" | "name";
  key: string;
  ids: string[];
};

export async function findContactDuplicateGroups(
  db: Database,
  limit: number,
): Promise<ContactDuplicateCandidate[]> {
  const result = await db.execute<ContactDuplicateCandidate>(sql`
    with active as (
      select id, company_id, lower(email) as email, phone,
             regexp_replace(translate(lower(first_name || last_name), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), '[^a-z0-9]', '', 'g') as normalized_name
      from contacts where archived_at is null
    )
    select 'email' as reason, email as key, array_agg(id order by id) as ids
      from active where email is not null group by email having count(*) > 1
    union all
    select 'phone', phone, array_agg(id order by id)
      from active where phone is not null group by phone having count(*) > 1
    union all
    select 'name', company_id::text || ':' || normalized_name, array_agg(id order by id)
      from active where normalized_name <> '' and company_id is not null
      group by company_id, normalized_name having count(*) > 1
    order by key
    limit ${limit}
  `);
  return rowsOf<ContactDuplicateCandidate>(result);
}

export async function listContactsByIds(db: Database, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ contact: contacts, companyName: companies.name })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .where(inArray(contacts.id, ids));
}

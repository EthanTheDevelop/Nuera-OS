import { and, asc, count, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { catalogItems, type CatalogItem } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

export type NewCatalogItem = typeof catalogItems.$inferInsert;

/** Un identifiant mal formé ne peut désigner aucune prestation : 404, pas une erreur SQL. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export interface CatalogItemFilter {
  search?: string;
  kind?: CatalogItem["kind"];
  active?: boolean;
}

function whereOf(filter: CatalogItemFilter): SQL | undefined {
  const search = filter.search ? `%${escapeLike(filter.search)}%` : null;
  return and(
    filter.kind ? eq(catalogItems.kind, filter.kind) : undefined,
    filter.active === undefined ? undefined : eq(catalogItems.active, filter.active),
    search
      ? or(ilike(catalogItems.name, search), ilike(catalogItems.description, search))
      : undefined,
  );
}

export async function findPage(
  db: Database,
  filter: CatalogItemFilter,
  paging: { page: number; pageSize: number },
): Promise<{ items: CatalogItem[]; total: number }> {
  const where = whereOf(filter);
  const [items, totals] = await Promise.all([
    db
      .select()
      .from(catalogItems)
      .where(where)
      .orderBy(asc(catalogItems.kind), asc(catalogItems.name), asc(catalogItems.id))
      .limit(paging.pageSize)
      .offset((paging.page - 1) * paging.pageSize),
    db.select({ total: count() }).from(catalogItems).where(where),
  ]);
  return { items, total: totals[0]?.total ?? 0 };
}

export async function findById(db: Database, id: string): Promise<CatalogItem | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(catalogItems).where(eq(catalogItems.id, id)).limit(1);
  return row ?? null;
}

export async function findByIds(db: Database, ids: string[]): Promise<CatalogItem[]> {
  if (ids.length === 0) return [];
  return db.select().from(catalogItems).where(inArray(catalogItems.id, ids));
}

/** Prestations proposables dans l'éditeur. Le catalogue d'une agence reste de taille raisonnable. */
export async function findActive(db: Database, limit: number): Promise<CatalogItem[]> {
  return db
    .select()
    .from(catalogItems)
    .where(eq(catalogItems.active, true))
    .orderBy(asc(catalogItems.kind), asc(catalogItems.name))
    .limit(limit);
}

export async function insert(db: Database, values: NewCatalogItem): Promise<CatalogItem> {
  const [row] = await db.insert(catalogItems).values(values).returning();
  if (!row) throw new Error("Prestation non créée.");
  return row;
}

export async function update(
  db: Database,
  id: string,
  values: Partial<NewCatalogItem>,
): Promise<CatalogItem | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db
    .update(catalogItems)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(catalogItems.id, id))
    .returning();
  return row ?? null;
}

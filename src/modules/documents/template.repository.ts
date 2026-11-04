import { and, asc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { templates, type Template } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { paginate, type PageParams, type Paginated } from "@/server/pagination";
import { lockIdempotencyKey, matchesSearch } from "./document.repository";
import type { TemplateRow } from "./document.types";

export interface TemplateQuery {
  search?: string | null;
  kinds?: Template["kind"][];
  activity?: Template["activity"];
  active?: boolean;
}

function templateCondition(query: TemplateQuery): SQL | undefined {
  return and(
    query.active === undefined ? undefined : eq(templates.active, query.active),
    query.kinds?.length ? inArray(templates.kind, query.kinds) : undefined,
    query.activity ? eq(templates.activity, query.activity) : undefined,
    matchesSearch([templates.name, templates.body, sql`${templates.items}::text`], query.search),
  );
}

/** Les éléments sont une colonne JSON libre : seules les lignes de texte sont gardées. */
function toRow(template: Template): TemplateRow {
  return {
    id: template.id,
    kind: template.kind,
    activity: template.activity,
    name: template.name,
    body: template.body,
    items: template.items.filter((item): item is string => typeof item === "string"),
    active: template.active,
    updatedAt: template.updatedAt,
  };
}

export async function listTemplates(
  db: Database,
  query: TemplateQuery,
  params: PageParams,
): Promise<Paginated<TemplateRow>> {
  const where = templateCondition(query);
  return paginate(params, {
    items: async (limit, offset) => {
      const rows = await db
        .select()
        .from(templates)
        .where(where)
        .orderBy(asc(templates.name), asc(templates.id))
        .limit(limit)
        .offset(offset);
      return rows.map(toRow);
    },
    count: async () => {
      const [row] = await db.select({ value: count() }).from(templates).where(where);
      return row?.value ?? 0;
    },
  });
}

export async function findTemplate(db: Database, id: string): Promise<TemplateRow | null> {
  const [row] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  return row ? toRow(row) : null;
}

/** Deux créations simultanées du même modèle se succèdent : la seconde retrouve la première. */
export function lockTemplateName(
  tx: Database,
  kind: Template["kind"],
  name: string,
): Promise<void> {
  return lockIdempotencyKey(tx, `template|${kind}|${name}`);
}

export async function findTemplateByName(
  db: Database,
  kind: Template["kind"],
  name: string,
): Promise<TemplateRow | null> {
  const [row] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.kind, kind), eq(templates.name, name), eq(templates.active, true)))
    .limit(1);
  return row ? toRow(row) : null;
}

export async function insertTemplate(
  tx: Database,
  values: typeof templates.$inferInsert,
): Promise<TemplateRow> {
  const [row] = await tx.insert(templates).values(values).returning();
  if (!row) throw new Error("Modèle non créé");
  return toRow(row);
}

export async function updateTemplate(
  tx: Database,
  id: string,
  patch: Partial<typeof templates.$inferInsert>,
): Promise<TemplateRow> {
  const [row] = await tx
    .update(templates)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(templates.id, id))
    .returning();
  if (!row) throw new Error("Modèle non modifié");
  return toRow(row);
}

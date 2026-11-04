import { and, asc, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  knowledgeArticles,
  knowledgeArticleVersions,
  projects,
  sites,
  users,
  type KnowledgeArticle,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { paginate, type PageParams, type Paginated } from "@/server/pagination";
import { lockIdempotencyKey, matchesSearch } from "./document.repository";
import type { ArticleDetail, ArticleRow, ArticleVersionRow } from "./document.types";

const rowColumns = {
  id: knowledgeArticles.id,
  kind: knowledgeArticles.kind,
  title: knowledgeArticles.title,
  siteId: knowledgeArticles.siteId,
  siteName: sites.name,
  projectId: knowledgeArticles.projectId,
  projectNumber: projects.number,
  projectName: projects.name,
  authorName: users.name,
  version: knowledgeArticles.version,
  archivedAt: knowledgeArticles.archivedAt,
  updatedAt: knowledgeArticles.updatedAt,
};

export interface ArticleQuery {
  search?: string | null;
  kind?: KnowledgeArticle["kind"] | null;
  siteId?: string | null;
  projectId?: string | null;
  archived?: boolean;
}

function articleCondition(query: ArticleQuery) {
  return and(
    query.archived ? isNotNull(knowledgeArticles.archivedAt) : isNull(knowledgeArticles.archivedAt),
    query.kind ? eq(knowledgeArticles.kind, query.kind) : undefined,
    query.siteId ? eq(knowledgeArticles.siteId, query.siteId) : undefined,
    query.projectId ? eq(knowledgeArticles.projectId, query.projectId) : undefined,
    matchesSearch(
      [knowledgeArticles.title, knowledgeArticles.body, sites.name, projects.number, projects.name],
      query.search,
    ),
  );
}

export async function listArticles(
  db: Database,
  query: ArticleQuery,
  params: PageParams,
): Promise<Paginated<ArticleRow>> {
  const where = articleCondition(query);
  return paginate(params, {
    items: (limit, offset) =>
      db
        .select(rowColumns)
        .from(knowledgeArticles)
        .leftJoin(sites, eq(knowledgeArticles.siteId, sites.id))
        .leftJoin(projects, eq(knowledgeArticles.projectId, projects.id))
        .leftJoin(users, eq(knowledgeArticles.authorUserId, users.id))
        .where(where)
        .orderBy(desc(knowledgeArticles.updatedAt), asc(knowledgeArticles.id))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ value: count() })
        .from(knowledgeArticles)
        .leftJoin(sites, eq(knowledgeArticles.siteId, sites.id))
        .leftJoin(projects, eq(knowledgeArticles.projectId, projects.id))
        .where(where);
      return row?.value ?? 0;
    },
  });
}

export async function findArticleDetail(db: Database, id: string): Promise<ArticleDetail | null> {
  const [row] = await db
    .select({ ...rowColumns, body: knowledgeArticles.body })
    .from(knowledgeArticles)
    .leftJoin(sites, eq(knowledgeArticles.siteId, sites.id))
    .leftJoin(projects, eq(knowledgeArticles.projectId, projects.id))
    .leftJoin(users, eq(knowledgeArticles.authorUserId, users.id))
    .where(eq(knowledgeArticles.id, id))
    .limit(1);
  return row ?? null;
}

/** Deux créations simultanées du même article se succèdent : la seconde retrouve la première. */
export function lockArticleTitle(tx: Database, title: string): Promise<void> {
  return lockIdempotencyKey(tx, `article|${title}`);
}

export async function findArticleByTitle(
  db: Database,
  title: string,
): Promise<KnowledgeArticle | null> {
  const [row] = await db
    .select()
    .from(knowledgeArticles)
    .where(and(eq(knowledgeArticles.title, title), isNull(knowledgeArticles.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function lockArticle(tx: Database, id: string): Promise<KnowledgeArticle | null> {
  const [row] = await tx
    .select()
    .from(knowledgeArticles)
    .where(eq(knowledgeArticles.id, id))
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function insertArticle(
  tx: Database,
  values: typeof knowledgeArticles.$inferInsert,
): Promise<KnowledgeArticle> {
  const [row] = await tx.insert(knowledgeArticles).values(values).returning();
  if (!row) throw new Error("Article non créé");
  return row;
}

export async function updateArticle(
  tx: Database,
  id: string,
  patch: Partial<typeof knowledgeArticles.$inferInsert>,
): Promise<KnowledgeArticle> {
  const [row] = await tx
    .update(knowledgeArticles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(knowledgeArticles.id, id))
    .returning();
  if (!row) throw new Error("Article non modifié");
  return row;
}

export async function insertArticleVersion(
  tx: Database,
  values: typeof knowledgeArticleVersions.$inferInsert,
): Promise<void> {
  await tx.insert(knowledgeArticleVersions).values(values).onConflictDoNothing();
}

export async function listArticleVersions(
  db: Database,
  articleId: string,
): Promise<ArticleVersionRow[]> {
  return db
    .select({
      id: knowledgeArticleVersions.id,
      version: knowledgeArticleVersions.version,
      body: knowledgeArticleVersions.body,
      authorName: users.name,
      at: knowledgeArticleVersions.at,
    })
    .from(knowledgeArticleVersions)
    .leftJoin(users, eq(knowledgeArticleVersions.authorUserId, users.id))
    .where(eq(knowledgeArticleVersions.articleId, articleId))
    .orderBy(desc(knowledgeArticleVersions.version));
}

export async function findArticleVersion(
  db: Database,
  articleId: string,
  version: number,
): Promise<{ body: string } | null> {
  const [row] = await db
    .select({ body: knowledgeArticleVersions.body })
    .from(knowledgeArticleVersions)
    .where(
      and(
        eq(knowledgeArticleVersions.articleId, articleId),
        eq(knowledgeArticleVersions.version, version),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function projectExists(db: Database, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), isNull(projects.archivedAt)))
    .limit(1);
  return Boolean(row);
}

export async function siteExists(db: Database, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, id), isNull(sites.archivedAt)))
    .limit(1);
  return Boolean(row);
}

const OPTION_LIMIT = 300;

export async function listArticleLinkOptions(db: Database) {
  const [siteRows, projectRows] = await Promise.all([
    db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(isNull(sites.archivedAt))
      .orderBy(asc(sites.name))
      .limit(OPTION_LIMIT),
    db
      .select({ id: projects.id, number: projects.number, name: projects.name })
      .from(projects)
      .where(isNull(projects.archivedAt))
      .orderBy(desc(projects.createdAt))
      .limit(OPTION_LIMIT),
  ]);
  return {
    sites: siteRows.map((row) => ({ id: row.id, label: row.name })),
    projects: projectRows.map((row) => ({ id: row.id, label: `${row.number} · ${row.name}` })),
  };
}

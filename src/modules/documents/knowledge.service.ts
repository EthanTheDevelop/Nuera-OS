import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan, assertCanAny } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { KnowledgeArticle } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parsePagination, type PageParams, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import {
  articleFilterSchema,
  articleIdSchema,
  createArticleSchema,
  restoreArticleVersionSchema,
  updateArticleSchema,
  type ArticleFilterInput,
  type CreateArticleInput,
  type UpdateArticleInput,
} from "./document.schema";
import type { ArticleDetail, ArticleRow, ArticleVersionRow, LinkOption } from "./document.types";
import * as repository from "./knowledge.repository";

const NOT_FOUND = "Cet article n'existe pas.";

async function assertLinks(
  db: Database,
  links: { siteId?: string | null; projectId?: string | null },
): Promise<void> {
  const errors: Record<string, string[]> = {};
  if (links.siteId && !(await repository.siteExists(db, links.siteId))) {
    errors.siteId = ["Ce site n'existe pas ou a été archivé."];
  }
  if (links.projectId && !(await repository.projectExists(db, links.projectId))) {
    errors.projectId = ["Ce projet n'existe pas ou a été archivé."];
  }
  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Certains rattachements sont invalides.", errors);
  }
}

/** La base n'a pas deux vérités sur un même sujet, y compris après un renommage ou une restauration. */
async function assertTitleFree(tx: Database, title: string): Promise<void> {
  await repository.lockArticleTitle(tx, title);
  if (await repository.findArticleByTitle(tx, title)) {
    const message = "Un article porte déjà ce titre.";
    throw new ConflictError(message, { title: [message] });
  }
}

function parseId(id: string): string {
  const parsed = articleIdSchema.safeParse({ id });
  if (!parsed.success) throw new NotFoundError(NOT_FOUND);
  return parsed.data.id;
}

export async function listKnowledgeArticles(
  ctx: ServiceContext,
  filter: ArticleFilterInput = {},
  page?: Partial<PageParams>,
): Promise<Paginated<ArticleRow>> {
  assertCan(ctx.actor, "knowledge:read");
  const data = parseInput(articleFilterSchema, filter);
  return repository.listArticles(ctx.db, data, parsePagination(page));
}

export async function getKnowledgeArticle(
  ctx: ServiceContext,
  articleId: string,
): Promise<{ article: ArticleDetail; versions: ArticleVersionRow[] }> {
  assertCan(ctx.actor, "knowledge:read");
  const id = parseId(articleId);
  const article = await repository.findArticleDetail(ctx.db, id);
  if (!article) throw new NotFoundError(NOT_FOUND);
  return { article, versions: await repository.listArticleVersions(ctx.db, id) };
}

export async function listKnowledgeLinkOptions(
  ctx: ServiceContext,
): Promise<{ sites: LinkOption[]; projects: LinkOption[] }> {
  assertCanAny(ctx.actor, ["knowledge:manage"]);
  return repository.listArticleLinkOptions(ctx.db);
}

/**
 * Crée un article et sa version 1. Répéter la même création renvoie le même article ; un autre
 * contenu sous le même titre est refusé : la base n'a pas deux vérités sur un même sujet.
 */
export async function createKnowledgeArticle(
  ctx: ServiceContext,
  input: CreateArticleInput,
): Promise<KnowledgeArticle> {
  assertCan(ctx.actor, "knowledge:manage");
  const data = parseInput(createArticleSchema, input);
  await assertLinks(ctx.db, data);

  return ctx.db.transaction(async (tx) => {
    await repository.lockArticleTitle(tx, data.title);
    const existing = await repository.findArticleByTitle(tx, data.title);
    if (existing) {
      if (existing.body === data.body && existing.kind === data.kind) return existing;
      const message = "Un article porte déjà ce titre.";
      throw new ConflictError(message, { title: [message] });
    }
    const article = await repository.insertArticle(tx, {
      kind: data.kind,
      title: data.title,
      body: data.body,
      siteId: data.siteId ?? null,
      projectId: data.projectId ?? null,
      authorUserId: ctx.actor.userId,
      version: 1,
    });
    await repository.insertArticleVersion(tx, {
      articleId: article.id,
      version: 1,
      body: data.body,
      authorUserId: ctx.actor.userId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "knowledge_article.created",
      entityType: "knowledge_article",
      entityId: article.id,
      metadata: { title: article.title, kind: article.kind },
    });
    return article;
  });
}

/** Un nouveau contenu ajoute une version ; un titre ou un rattachement seul n'en crée pas. */
export async function updateKnowledgeArticle(
  ctx: ServiceContext,
  input: UpdateArticleInput,
): Promise<KnowledgeArticle> {
  assertCan(ctx.actor, "knowledge:manage");
  const { id, expectedVersion, ...data } = parseInput(updateArticleSchema, input);

  return ctx.db.transaction(async (tx) => {
    const article = await repository.lockArticle(tx, id);
    if (!article) throw new NotFoundError(NOT_FOUND);
    if (article.archivedAt) throw new ConflictError("Restaurez cet article avant de le modifier.");

    const sameContent = article.body === data.body;
    const unchanged =
      sameContent &&
      article.title === data.title &&
      article.kind === data.kind &&
      article.siteId === (data.siteId ?? null) &&
      article.projectId === (data.projectId ?? null);
    if (unchanged) return article;

    if (article.version !== expectedVersion) {
      throw new ConflictError(
        `Cet article est passé en version ${article.version} entre-temps. Rechargez la page avant de le modifier.`,
      );
    }
    // Un lien déjà en place reste valable même si son objet a été archivé depuis.
    await assertLinks(tx, {
      siteId: data.siteId === article.siteId ? null : data.siteId,
      projectId: data.projectId === article.projectId ? null : data.projectId,
    });
    if (data.title !== article.title) await assertTitleFree(tx, data.title);

    const version = sameContent ? article.version : article.version + 1;
    const updated = await repository.updateArticle(tx, id, {
      kind: data.kind,
      title: data.title,
      body: data.body,
      siteId: data.siteId ?? null,
      projectId: data.projectId ?? null,
      version,
      authorUserId: sameContent ? article.authorUserId : ctx.actor.userId,
    });
    if (!sameContent) {
      await repository.insertArticleVersion(tx, {
        articleId: id,
        version,
        body: data.body,
        authorUserId: ctx.actor.userId,
      });
    }
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "knowledge_article.updated",
      entityType: "knowledge_article",
      entityId: id,
      metadata: { title: updated.title, version },
    });
    return updated;
  });
}

/** Reprend le contenu d'une ancienne version, en créant une nouvelle : l'historique ne se réécrit pas. */
export async function restoreKnowledgeArticleVersion(
  ctx: ServiceContext,
  input: { id: string; version: number },
): Promise<KnowledgeArticle> {
  assertCan(ctx.actor, "knowledge:manage");
  const { id, version } = parseInput(restoreArticleVersionSchema, input);

  return ctx.db.transaction(async (tx) => {
    const article = await repository.lockArticle(tx, id);
    if (!article) throw new NotFoundError(NOT_FOUND);
    if (article.archivedAt) throw new ConflictError("Restaurez cet article avant de le modifier.");
    const previous = await repository.findArticleVersion(tx, id, version);
    if (!previous) throw new NotFoundError("Cette version n'existe pas.");
    if (previous.body === article.body) return article;

    const next = article.version + 1;
    const updated = await repository.updateArticle(tx, id, {
      body: previous.body,
      version: next,
      authorUserId: ctx.actor.userId,
    });
    await repository.insertArticleVersion(tx, {
      articleId: id,
      version: next,
      body: previous.body,
      authorUserId: ctx.actor.userId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "knowledge_article.updated",
      entityType: "knowledge_article",
      entityId: id,
      metadata: { restoredFrom: version, version: next },
    });
    return updated;
  });
}

async function setArchived(
  ctx: ServiceContext,
  articleId: string,
  archived: boolean,
): Promise<KnowledgeArticle> {
  assertCan(ctx.actor, "knowledge:manage");
  const { id } = parseInput(articleIdSchema, { id: articleId });

  return ctx.db.transaction(async (tx) => {
    const article = await repository.lockArticle(tx, id);
    if (!article) throw new NotFoundError(NOT_FOUND);
    if (Boolean(article.archivedAt) === archived) return article;
    if (!archived) await assertTitleFree(tx, article.title);
    const updated = await repository.updateArticle(tx, id, {
      archivedAt: archived ? new Date() : null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: archived ? "knowledge_article.archived" : "knowledge_article.restored",
      entityType: "knowledge_article",
      entityId: id,
      metadata: { title: article.title },
    });
    return updated;
  });
}

export const archiveKnowledgeArticle = (ctx: ServiceContext, id: string) =>
  setArchived(ctx, id, true);

export const restoreKnowledgeArticle = (ctx: ServiceContext, id: string) =>
  setArchived(ctx, id, false);

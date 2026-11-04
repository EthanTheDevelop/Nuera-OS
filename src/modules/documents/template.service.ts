import type { OfferActivity } from "@/lib/domain-enums";
import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan, assertCanAny } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { ConflictError, NotFoundError } from "@/server/errors";
import { parsePagination, type PageParams, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import {
  createTemplateSchema,
  templateActiveSchema,
  templateFilterSchema,
  templateIdSchema,
  updateTemplateSchema,
  type CreateTemplateInput,
  type TemplateFilterInput,
  type UpdateTemplateInput,
} from "./document.schema";
import type { TemplateRow } from "./document.types";
import * as repository from "./template.repository";

const NOT_FOUND = "Ce modèle n'existe pas.";

const sameItems = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

export async function listTemplates(
  ctx: ServiceContext,
  filter: TemplateFilterInput = {},
  page?: Partial<PageParams>,
): Promise<Paginated<TemplateRow>> {
  assertCan(ctx.actor, "knowledge:read");
  const data = parseInput(templateFilterSchema, filter);
  return repository.listTemplates(ctx.db, data, parsePagination(page));
}

/** Plans de projet actifs, pour le lot Projets : ceux de l'activité, puis les génériques. */
export async function listProjectPlanTemplates(
  ctx: ServiceContext,
  options: { activity?: OfferActivity | null } = {},
): Promise<TemplateRow[]> {
  assertCanAny(ctx.actor, ["knowledge:read", "projects:create", "projects:update"]);
  const { items } = await repository.listTemplates(
    ctx.db,
    { kinds: ["project_plan"], active: true },
    { page: 1, pageSize: 100 },
  );
  if (!options.activity) return items;
  return items
    .filter((item) => item.activity === options.activity || item.activity === null)
    .sort((a, b) => Number(b.activity !== null) - Number(a.activity !== null));
}

export async function getTemplate(ctx: ServiceContext, templateId: string): Promise<TemplateRow> {
  assertCan(ctx.actor, "knowledge:read");
  const parsed = templateIdSchema.safeParse({ id: templateId });
  if (!parsed.success) throw new NotFoundError(NOT_FOUND);
  const template = await repository.findTemplate(ctx.db, parsed.data.id);
  if (!template) throw new NotFoundError(NOT_FOUND);
  return template;
}

/**
 * « Nouveau modèle ». Répéter la même création renvoie le même modèle ; un autre contenu sous le
 * même nom et le même type est refusé.
 */
export async function createTemplate(
  ctx: ServiceContext,
  input: CreateTemplateInput,
): Promise<TemplateRow> {
  assertCan(ctx.actor, "knowledge:manage");
  const data = parseInput(createTemplateSchema, input);

  return ctx.db.transaction(async (tx) => {
    await repository.lockTemplateName(tx, data.kind, data.name);
    const existing = await repository.findTemplateByName(tx, data.kind, data.name);
    if (existing) {
      if (existing.body === (data.body ?? null) && sameItems(existing.items, data.items)) {
        return existing;
      }
      const message = "Un modèle de ce type porte déjà ce nom.";
      throw new ConflictError(message, { name: [message] });
    }
    const template = await repository.insertTemplate(tx, {
      kind: data.kind,
      activity: data.activity ?? null,
      name: data.name,
      body: data.body ?? null,
      items: data.items,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "template.created",
      entityType: "template",
      entityId: template.id,
      metadata: { name: template.name, kind: template.kind },
    });
    return template;
  });
}

export async function updateTemplate(
  ctx: ServiceContext,
  input: UpdateTemplateInput,
): Promise<TemplateRow> {
  assertCan(ctx.actor, "knowledge:manage");
  const { id, ...data } = parseInput(updateTemplateSchema, input);

  return ctx.db.transaction(async (tx) => {
    const existing = await repository.findTemplate(tx, id);
    if (!existing) throw new NotFoundError(NOT_FOUND);
    const unchanged =
      existing.kind === data.kind &&
      existing.activity === (data.activity ?? null) &&
      existing.name === data.name &&
      existing.body === (data.body ?? null) &&
      sameItems(existing.items, data.items);
    if (unchanged) return existing;

    await repository.lockTemplateName(tx, data.kind, data.name);
    const homonym = await repository.findTemplateByName(tx, data.kind, data.name);
    if (homonym && homonym.id !== id) {
      const message = "Un modèle de ce type porte déjà ce nom.";
      throw new ConflictError(message, { name: [message] });
    }
    const updated = await repository.updateTemplate(tx, id, {
      kind: data.kind,
      activity: data.activity ?? null,
      name: data.name,
      body: data.body ?? null,
      items: data.items,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "template.updated",
      entityType: "template",
      entityId: id,
      metadata: { name: updated.name, kind: updated.kind },
    });
    return updated;
  });
}

/** Un modèle se désactive, il ne se supprime pas : ce qui en est issu garde son origine. */
export async function setTemplateActive(
  ctx: ServiceContext,
  input: { id: string; active: boolean },
): Promise<TemplateRow> {
  assertCan(ctx.actor, "knowledge:manage");
  const { id, active } = parseInput(templateActiveSchema, input);

  return ctx.db.transaction(async (tx) => {
    const existing = await repository.findTemplate(tx, id);
    if (!existing) throw new NotFoundError(NOT_FOUND);
    if (existing.active === active) return existing;
    if (active) {
      await repository.lockTemplateName(tx, existing.kind, existing.name);
      const homonym = await repository.findTemplateByName(tx, existing.kind, existing.name);
      if (homonym) throw new ConflictError("Un modèle actif de ce type porte déjà ce nom.");
    }
    const updated = await repository.updateTemplate(tx, id, { active });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: active ? "template.updated" : "template.deactivated",
      entityType: "template",
      entityId: id,
      metadata: { name: existing.name, active },
    });
    return updated;
  });
}

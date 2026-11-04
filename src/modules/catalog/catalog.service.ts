import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan, can } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { CatalogItem } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import * as catalogRepository from "./catalog.repository";
import { catalogItemInputSchema, catalogListSchema, type CatalogListInput } from "./catalog.schema";

/** Au-delà, l'éditeur de devis garde les premières prestations : une agence n'en vend pas autant. */
const ACTIVE_OPTIONS_LIMIT = 500;

export type { CatalogItem };

const STATE_FILTER = { active: true, inactive: false, all: undefined } as const;

/**
 * Le coût estimé est réservé à qui compose les devis ou gère le catalogue. Le rôle Lecture voit les
 * prix : le coût lui revient à 0, et l'écran retire la colonne.
 */
export function canSeeCatalogCosts(actor: ServiceContext["actor"]): boolean {
  return can(actor, "catalog:manage") || can(actor, "quotes:update");
}

function visibleTo(ctx: ServiceContext, item: CatalogItem): CatalogItem {
  return canSeeCatalogCosts(ctx.actor) ? item : { ...item, estimatedCostCents: 0 };
}

/** Catalogue paginé (`catalog:read`). */
export async function listCatalogItems(ctx: ServiceContext, input: CatalogListInput = {}) {
  assertCan(ctx.actor, "catalog:read");
  const { search, kind, state, page, pageSize } = parseInput(catalogListSchema, input);
  const { items, total } = await catalogRepository.findPage(
    ctx.db,
    { search, kind, active: STATE_FILTER[state] },
    { page, pageSize },
  );
  return { items: items.map((item) => visibleTo(ctx, item)), total, page, pageSize };
}

export async function getCatalogItem(ctx: ServiceContext, id: string): Promise<CatalogItem> {
  assertCan(ctx.actor, "catalog:read");
  const item = await catalogRepository.findById(ctx.db, id);
  if (!item) throw new NotFoundError("Prestation introuvable.");
  return visibleTo(ctx, item);
}

/** Prestations actives, pour composer un devis. */
export async function listActiveCatalogItems(ctx: ServiceContext): Promise<CatalogItem[]> {
  assertCan(ctx.actor, "catalog:read");
  const items = await catalogRepository.findActive(ctx.db, ACTIVE_OPTIONS_LIMIT);
  return items.map((item) => visibleTo(ctx, item));
}

/** Lignes du catalogue référencées par un devis : pour le contrôle côté serveur du module Devis. */
export async function getCatalogItemsByIds(
  ctx: Pick<ServiceContext, "db">,
  ids: string[],
): Promise<CatalogItem[]> {
  return catalogRepository.findByIds(ctx.db, [...new Set(ids)]);
}

export async function createCatalogItem(ctx: ServiceContext, input: unknown): Promise<CatalogItem> {
  assertCan(ctx.actor, "catalog:manage");
  const data = parseInput(catalogItemInputSchema, input);
  return ctx.db.transaction(async (tx) => {
    const item = await catalogRepository.insert(tx, data);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "catalog_item.created",
      entityType: "catalog_item",
      entityId: item.id,
      metadata: { name: item.name, kind: item.kind },
    });
    return item;
  });
}

/**
 * Modifie une prestation. Les devis existants n'en dépendent pas : leurs lignes sont des copies
 * figées, seule une nouvelle ligne reprendra le nouveau prix.
 */
export async function updateCatalogItem(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<CatalogItem> {
  assertCan(ctx.actor, "catalog:manage");
  const data = parseInput(catalogItemInputSchema, input);
  return ctx.db.transaction(async (tx) => {
    const item = await catalogRepository.update(tx, id, data);
    if (!item) throw new NotFoundError("Prestation introuvable.");
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "catalog_item.updated",
      entityType: "catalog_item",
      entityId: item.id,
      metadata: { name: item.name, priceCents: item.priceCents },
    });
    return item;
  });
}

/**
 * Retire une prestation de la vente, ou l'y remet. Jamais de suppression : d'anciennes lignes de
 * devis la référencent. Idempotent : un second appel identique n'écrit rien.
 */
export async function setCatalogItemActive(
  ctx: ServiceContext,
  id: string,
  active: boolean,
): Promise<CatalogItem> {
  assertCan(ctx.actor, "catalog:manage");
  return ctx.db.transaction(async (tx) => {
    const current = await catalogRepository.findById(tx, id);
    if (!current) throw new NotFoundError("Prestation introuvable.");
    if (current.active === active) return current;
    const item = await catalogRepository.update(tx, id, { active });
    if (!item) throw new NotFoundError("Prestation introuvable.");
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: active ? "catalog_item.updated" : "catalog_item.deactivated",
      entityType: "catalog_item",
      entityId: item.id,
      metadata: { name: item.name, active },
    });
    return item;
  });
}

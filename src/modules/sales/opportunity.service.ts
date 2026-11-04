import { randomUUID } from "node:crypto";
import type {
  CrmOpportunity,
  UpdateOpportunityInput as CrmUpdateOpportunity,
} from "@/integrations/twenty/crm-gateway";
import { OPPORTUNITY_STAGES, type OpportunityStage } from "@/lib/domain-enums";
import { recordAudit } from "@/modules/audit/audit.service";
import { getCompanyRef, getContactRef } from "@/modules/crm/company.lookup";
import { createCompany } from "@/modules/crm/company.service";
import { assertCrmWritable, deriveUuid } from "@/modules/crm/crm.shared";
import { emitEvent } from "@/modules/platform/events";
import { getMembersByIds } from "@/modules/team/team.lookup";
import { assertCan, can } from "@/server/auth/permissions";
import { requireCrm, type ServiceContext } from "@/server/context";
import type { Opportunity } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parsePagination, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import * as repository from "./opportunity.repository";
import {
  createOpportunitySchema,
  moveOpportunitySchema,
  nextActionSchema,
  opportunityFiltersSchema,
  updateOpportunitySchema,
  type OpportunityFilters,
} from "./opportunity.schema";
import { applyStageChange } from "./opportunity.stage";
import {
  assertOpportunityTransition,
  isOpportunityClosed,
  OPPORTUNITY_REOPEN_TRANSITIONS,
} from "./opportunity.status";

/** Colonnes (T) d'une affaire, telles que Twenty les renvoie (hors client et contact). */
export function opportunityTwentyColumns(record: CrmOpportunity) {
  return {
    name: record.name,
    amountCents: record.amount?.cents ?? null,
    expectedCloseOn: record.closeDate,
    archivedAt: record.deletedAt ? new Date(record.deletedAt) : null,
    twentySyncedAt: new Date(record.updatedAt),
  };
}

function amountFor(cents: number | null | undefined) {
  return cents === null || cents === undefined
    ? (cents as null | undefined)
    : { cents, currency: "EUR" as const };
}

// --- Lectures ---------------------------------------------------------------------------------

export interface OpportunityView {
  id: string;
  name: string;
  stage: OpportunityStage;
  amountCents: number | null;
  expectedCloseOn: string | null;
  probability: number | null;
  source: string | null;
  need: string | null;
  budgetEstimateCents: number | null;
  ownerMemberId: string | null;
  ownerName: string | null;
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  nextAction: string | null;
  nextActionOn: string | null;
  lostReason: string | null;
  wonAt: Date | null;
  lostAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  /** Jours entiers depuis la dernière activité (la création, à défaut). */
  idleDays: number;
}

function toView(row: repository.OpportunityRowData, now: Date): OpportunityView {
  const { opportunity } = row;
  const last = opportunity.lastActivityAt ?? opportunity.createdAt;
  return {
    id: opportunity.id,
    name: opportunity.name,
    stage: opportunity.stage,
    amountCents: opportunity.amountCents,
    expectedCloseOn: opportunity.expectedCloseOn,
    probability: opportunity.probability,
    source: opportunity.source,
    need: opportunity.need,
    budgetEstimateCents: opportunity.budgetEstimateCents,
    ownerMemberId: opportunity.ownerMemberId,
    ownerName: row.ownerName,
    companyId: opportunity.companyId,
    companyName: row.companyName,
    contactId: opportunity.contactId,
    contactName:
      row.contactFirstName !== null || row.contactLastName !== null
        ? [row.contactFirstName, row.contactLastName].filter(Boolean).join(" ")
        : null,
    nextAction: opportunity.nextAction,
    nextActionOn: opportunity.nextActionOn,
    lostReason: opportunity.lostReason,
    wonAt: opportunity.wonAt,
    lostAt: opportunity.lostAt,
    archivedAt: opportunity.archivedAt,
    createdAt: opportunity.createdAt,
    idleDays: Math.max(0, Math.floor((now.getTime() - last.getTime()) / 86_400_000)),
  };
}

export async function listOpportunities(
  ctx: ServiceContext,
  rawFilters: unknown,
): Promise<Paginated<OpportunityView>> {
  assertCan(ctx.actor, "sales:read");
  const filters = opportunityFiltersSchema.parse(rawFilters ?? {});
  const now = new Date();
  const page = await repository.listOpportunityPage(
    ctx.db,
    filters,
    parsePagination(rawFilters as { page?: unknown }),
    now,
  );
  return { ...page, items: page.items.map((row) => toView(row, now)) };
}

export const BOARD_CARDS_PER_COLUMN = 40;

export interface PipelineColumnSummary {
  stage: OpportunityStage;
  total: number;
  amountCents: number;
}

export interface PipelineBoard {
  cards: OpportunityView[];
  columns: PipelineColumnSummary[];
  openCount: number;
  openAmountCents: number;
  /** Cartes non affichées, faute de place : la vue liste les donne toutes. */
  hiddenCount: number;
}

export async function getPipelineBoard(
  ctx: ServiceContext,
  rawFilters: unknown,
): Promise<PipelineBoard> {
  assertCan(ctx.actor, "sales:read");
  const parsed: OpportunityFilters = opportunityFiltersSchema.parse(rawFilters ?? {});
  // L'étape est le découpage même du tableau.
  const filters = { ...parsed, etape: undefined };
  const now = new Date();
  const [rows, summary] = await Promise.all([
    repository.listBoardRows(ctx.db, filters, BOARD_CARDS_PER_COLUMN, now),
    repository.summarizeByStage(ctx.db, filters, now),
  ]);
  const columns = OPPORTUNITY_STAGES.map((stage) => {
    const entry = summary.find((row) => row.stage === stage);
    return { stage, total: entry?.total ?? 0, amountCents: Number(entry?.amountCents ?? 0) };
  });
  const open = columns.filter((column) => !isOpportunityClosed(column.stage));
  const total = columns.reduce((sum, column) => sum + column.total, 0);
  return {
    cards: rows.map((row) => toView(row, now)),
    columns,
    openCount: open.reduce((sum, column) => sum + column.total, 0),
    openAmountCents: open.reduce((sum, column) => sum + column.amountCents, 0),
    hiddenCount: Math.max(0, total - rows.length),
  };
}

/** Résumé du pipeline, tous filtres levés, pour un autre écran (tableau de bord, reporting). */
export async function getPipelineSummary(ctx: ServiceContext): Promise<PipelineColumnSummary[]> {
  assertCan(ctx.actor, "sales:read");
  const summary = await repository.summarizeByStage(ctx.db, {}, new Date());
  return OPPORTUNITY_STAGES.map((stage) => {
    const entry = summary.find((row) => row.stage === stage);
    return { stage, total: entry?.total ?? 0, amountCents: Number(entry?.amountCents ?? 0) };
  });
}

export async function getOpportunityFilterOptions(ctx: ServiceContext) {
  assertCan(ctx.actor, "sales:read");
  return repository.listDistinctOpportunityFilters(ctx.db);
}

export async function getOpportunity(ctx: ServiceContext, id: string): Promise<OpportunityView> {
  assertCan(ctx.actor, "sales:read");
  const row = await repository.getOpportunityRow(ctx.db, id);
  if (!row) throw new NotFoundError("Affaire introuvable.");
  return toView(row, new Date());
}

export async function getOpportunityStageHistory(ctx: ServiceContext, id: string) {
  assertCan(ctx.actor, "sales:read");
  return repository.listStageHistory(ctx.db, id);
}

/** Devis et projets issus d'une affaire (03.04.02), chacun selon le droit de le lire. */
export async function getOpportunityCommercialLinks(ctx: ServiceContext, id: string) {
  assertCan(ctx.actor, "sales:read");
  const current = await repository.findOpportunityById(ctx.db, id);
  if (!current) throw new NotFoundError("Affaire introuvable.");
  const [quotes, projects] = await Promise.all([
    can(ctx.actor, "quotes:read") ? repository.listQuotesOfOpportunity(ctx.db, id) : [],
    can(ctx.actor, "projects:read") ? repository.listProjectsOfOpportunity(ctx.db, id) : [],
  ]);
  return { quotes, projects };
}

/** Lecture de la fiche 360° : affaires d'un client, les ouvertes d'abord. */
export async function listOpportunitiesForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<OpportunityView[]> {
  assertCan(ctx.actor, "sales:read");
  const now = new Date();
  const rows = await repository.listOpportunitiesOfCompany(ctx.db, companyId, options);
  return rows.map((row) => toView(row, now));
}

// --- Règles -----------------------------------------------------------------------------------

/** `current` : les liens déjà en place restent valables, même si la fiche liée a été archivée depuis. */
async function resolveParties(
  ctx: ServiceContext,
  input: { companyId?: string | null; contactId?: string | null },
  current?: { companyId: string | null; contactId: string | null },
) {
  const company = input.companyId ? await getCompanyRef(ctx.db, input.companyId) : null;
  if (input.companyId && (!company || company.mergedIntoId)) {
    throw new NotFoundError("Client introuvable.");
  }
  if (company?.archivedAt && company.id !== current?.companyId) {
    throw new ConflictError("Ce client est archivé.");
  }
  const contact = input.contactId ? await getContactRef(ctx.db, input.contactId) : null;
  if (input.contactId && !contact) throw new NotFoundError("Contact introuvable.");
  if (contact?.archivedAt && contact.id !== current?.contactId) {
    throw new ConflictError("Ce contact est archivé.", {
      contactId: ["Ce contact est archivé."],
    });
  }
  // Cloisonnement : un contact d'un autre client est refusé ici avant de l'être par la base.
  if (contact && contact.companyId !== (company?.id ?? null)) {
    throw new ConflictError("Ce contact appartient à un autre client.", {
      contactId: ["Ce contact appartient à un autre client."],
    });
  }
  return { company, contact };
}

async function assertOwnerExists(ctx: ServiceContext, ownerMemberId: string | null | undefined) {
  if (!ownerMemberId) return;
  const [owner] = await getMembersByIds(ctx.db, [ownerMemberId]);
  if (!owner) {
    throw new ValidationError("Responsable inconnu.", { ownerMemberId: ["Responsable inconnu."] });
  }
}

// --- Écritures --------------------------------------------------------------------------------

export async function createOpportunity(ctx: ServiceContext, input: unknown): Promise<Opportunity> {
  assertCan(ctx.actor, "sales:create");
  const data = parseInput(createOpportunitySchema, input);
  const id = data.id ?? randomUUID();

  const existing = await repository.findOpportunityById(ctx.db, id);
  if (existing) return existing;

  await assertOwnerExists(ctx, data.ownerMemberId);

  let companyId = data.companyId ?? null;
  if (!companyId && data.newCompanyName) {
    // Identifiant dérivé de l'affaire : une reprise retrouve le même prospect.
    const company = await createCompany(ctx, {
      id: deriveUuid("opportunity-company", id),
      name: data.newCompanyName,
      source: data.source ?? undefined,
      ownerMemberId: data.ownerMemberId ?? undefined,
      status: "prospect",
    });
    companyId = company.id;
  }
  const { company, contact } = await resolveParties(ctx, {
    companyId,
    contactId: data.contactId,
  });
  if (company) assertCrmWritable(company.twentyId);
  if (contact) assertCrmWritable(contact.twentyId);

  const stage = data.stage ?? "NEW";
  const record = await requireCrm(ctx).createOpportunity({
    id,
    name: data.name,
    stage,
    amount: amountFor(data.amountCents) ?? null,
    closeDate: data.expectedCloseOn ?? null,
    companyId: company?.twentyId ?? null,
    pointOfContactId: contact?.twentyId ?? null,
  });

  const now = new Date();
  return ctx.db.transaction(async (tx) => {
    const local = {
      probability: data.probability ?? null,
      source: data.source ?? null,
      need: data.need ?? null,
      budgetEstimateCents: data.budgetEstimateCents ?? null,
      ownerMemberId: data.ownerMemberId ?? null,
      nextAction: data.nextAction ?? null,
      nextActionOn: data.nextActionOn ?? null,
    };
    const row = await repository.insertOpportunity(tx, {
      id,
      twentyId: record.id,
      companyId: company?.id ?? null,
      contactId: contact?.id ?? null,
      stage,
      lastActivityAt: now,
      ...opportunityTwentyColumns(record),
      ...local,
    });
    if (!row) {
      const projected = await repository.findOpportunityByTwentyId(tx, record.id);
      if (!projected) throw new Error("Affaire introuvable après un conflit d'insertion");
      return repository.updateOpportunityRow(tx, projected.id, local);
    }
    await repository.insertStageHistory(tx, {
      opportunityId: row.id,
      fromStage: null,
      toStage: stage,
      actorId: ctx.actor.userId,
      at: now,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "opportunity.created",
      entityType: "opportunity",
      entityId: row.id,
      metadata: { name: row.name, stage, companyId: row.companyId, source: row.source },
    });
    await emitEvent(tx, {
      type: "opportunity.created",
      entityType: "opportunity",
      entityId: row.id,
      companyId: row.companyId,
      payload: { name: row.name, stage, amountCents: row.amountCents },
      actorId: ctx.actor.userId,
      dedupeKey: `opportunity.created:${row.id}`,
    });
    return row;
  });
}

export async function updateOpportunity(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<Opportunity> {
  assertCan(ctx.actor, "sales:update");
  const data = parseInput(updateOpportunitySchema, input);
  const current = await repository.findOpportunityById(ctx.db, id);
  if (!current) throw new NotFoundError("Affaire introuvable.");
  if (current.archivedAt) {
    throw new ConflictError("Cette affaire est archivée : restaurez-la pour la modifier.");
  }
  await assertOwnerExists(ctx, data.ownerMemberId);

  const nextCompanyId = data.companyId !== undefined ? data.companyId : current.companyId;
  const companyChanged = nextCompanyId !== current.companyId;
  const nextContactId =
    data.contactId !== undefined ? data.contactId : companyChanged ? null : current.contactId;
  const { company, contact } = await resolveParties(
    ctx,
    { companyId: nextCompanyId, contactId: nextContactId },
    current,
  );

  if (companyChanged && (await repository.hasCommercialChildren(ctx.db, id))) {
    throw new ConflictError(
      "Un devis ou un projet est rattaché à cette affaire : son client ne peut plus changer.",
    );
  }
  if (current.stage === "WON") {
    const fieldErrors: Record<string, string[]> = {};
    if (!nextCompanyId) fieldErrors.companyId = ["Une affaire gagnée exige un client."];
    if (data.amountCents === null || data.amountCents === 0) {
      fieldErrors.amountCents = ["Une affaire gagnée exige un montant."];
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ConflictError("Une affaire gagnée exige un client et un montant.", fieldErrors);
    }
  }

  const patch: CrmUpdateOpportunity = {};
  if (data.name !== undefined && data.name !== current.name) patch.name = data.name;
  if (data.amountCents !== undefined && data.amountCents !== current.amountCents) {
    patch.amount = amountFor(data.amountCents) ?? null;
  }
  if (data.expectedCloseOn !== undefined && data.expectedCloseOn !== current.expectedCloseOn) {
    patch.closeDate = data.expectedCloseOn;
  }
  if (companyChanged) patch.companyId = company?.twentyId ?? null;
  if (nextContactId !== current.contactId) patch.pointOfContactId = contact?.twentyId ?? null;

  let record: CrmOpportunity | null = null;
  if (Object.keys(patch).length > 0) {
    assertCrmWritable(current.twentyId);
    if (company && companyChanged) assertCrmWritable(company.twentyId);
    if (contact) assertCrmWritable(contact.twentyId);
    record = await requireCrm(ctx).updateOpportunity(current.twentyId, patch);
  }

  const local = {
    probability: data.probability,
    source: data.source,
    need: data.need,
    budgetEstimateCents: data.budgetEstimateCents,
    ownerMemberId: data.ownerMemberId,
    nextAction: data.nextAction,
    nextActionOn: data.nextActionOn,
  };

  return ctx.db.transaction(async (tx) => {
    if (companyChanged) {
      await repository.moveOpportunityToCompany(tx, id, nextCompanyId, nextContactId);
    }
    const row = await repository.updateOpportunityRow(tx, id, {
      ...(record ? { ...opportunityTwentyColumns(record), archivedAt: current.archivedAt } : {}),
      ...(companyChanged ? {} : { contactId: nextContactId }),
      ...local,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "opportunity.updated",
      entityType: "opportunity",
      entityId: id,
      metadata: {
        crmFields: Object.keys(patch),
        companyId: row.companyId,
      },
    });
    return row;
  });
}

/** Prochaine action et date de relance : colonnes de Nuera, donc disponibles si Twenty est coupé. */
export async function setNextAction(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<Opportunity> {
  assertCan(ctx.actor, "sales:update");
  const data = parseInput(nextActionSchema, input);
  const current = await repository.findOpportunityById(ctx.db, id);
  if (!current) throw new NotFoundError("Affaire introuvable.");
  if (current.archivedAt) {
    throw new ConflictError("Cette affaire est archivée : restaurez-la pour la modifier.");
  }
  return ctx.db.transaction(async (tx) => {
    const row = await repository.updateOpportunityRow(tx, id, {
      nextAction: data.nextAction,
      nextActionOn: data.nextActionOn,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "opportunity.updated",
      entityType: "opportunity",
      entityId: id,
      metadata: { fields: ["nextAction", "nextActionOn"] },
    });
    return row;
  });
}

/**
 * Change l'étape : Kanban, liste ou fiche. La ligne reste verrouillée le temps de l'aller-retour vers
 * Twenty : deux déplacements simultanés passent l'un après l'autre, et le second est jugé par la
 * machine à états sur l'étape laissée par le premier. Déjà à cette étape : rien n'est journalisé.
 */
export async function moveOpportunityStage(
  ctx: ServiceContext,
  input: unknown,
): Promise<Opportunity> {
  assertCan(ctx.actor, "sales:update");
  const data = parseInput(moveOpportunitySchema, input);
  return ctx.db.transaction(async (tx) => {
    const current = await repository.lockOpportunityById(tx, data.opportunityId);
    if (!current) throw new NotFoundError("Affaire introuvable.");
    if (current.archivedAt) throw new ConflictError("Cette affaire est archivée.");
    if (current.stage === data.toStage) {
      // Reprise après un webhook passé sans motif : on complète, sans rien répéter.
      return data.toStage === "LOST" && data.lostReason && !current.lostReason
        ? repository.updateOpportunityRow(tx, current.id, { lostReason: data.lostReason })
        : current;
    }

    assertOpportunityTransition(current.stage, data.toStage, {
      role: ctx.actor.role,
      companyId: current.companyId,
      amountCents: current.amountCents,
      lostReason: data.lostReason,
    });
    if (OPPORTUNITY_REOPEN_TRANSITIONS[current.stage].includes(data.toStage)) {
      assertCan(ctx.actor, "sales:reopen");
    }

    assertCrmWritable(current.twentyId);
    const record = await requireCrm(ctx).updateOpportunity(current.twentyId, {
      stage: data.toStage,
    });
    return applyStageChange(tx, current, {
      to: data.toStage,
      actorId: ctx.actor.userId,
      lostReason: data.lostReason,
      via: "user",
      columns: { twentySyncedAt: new Date(record.updatedAt) },
    });
  });
}

const WALK_TO_QUOTE_SENT: Readonly<Record<OpportunityStage, readonly OpportunityStage[]>> = {
  NEW: ["QUALIFIED", "QUOTE_SENT"],
  QUALIFIED: ["QUOTE_SENT"],
  QUOTE_SENT: [],
  NEGOTIATION: ["QUOTE_SENT"],
  WON: [],
  LOST: [],
};

/**
 * Un devis vient d'être envoyé (lot Devis). À appeler dans sa transaction. Les droits sont ceux de
 * l'envoi du devis, déjà vérifiés par l'appelant. L'affaire avance étape par étape dans la machine,
 * pas de saut. Déjà à « Devis envoyé » : rien. Close : rien non plus, un devis ne rouvre pas une
 * affaire. Si Twenty est coupé, l'erreur remonte et annule la transaction du devis.
 */
export async function markQuoteSent(
  ctx: ServiceContext,
  tx: Database,
  input: { opportunityId: string },
): Promise<Opportunity> {
  let current = await repository.lockOpportunityById(tx, input.opportunityId);
  if (!current) throw new NotFoundError("Affaire introuvable.");
  const steps = WALK_TO_QUOTE_SENT[current.stage];
  if (steps.length === 0) return current;

  let from: OpportunityStage = current.stage;
  for (const to of steps) {
    assertOpportunityTransition(from, to, {
      role: ctx.actor.role,
      companyId: current.companyId,
      amountCents: current.amountCents,
    });
    from = to;
  }

  assertCrmWritable(current.twentyId);
  const record = await requireCrm(ctx).updateOpportunity(current.twentyId, {
    stage: "QUOTE_SENT",
  });
  for (const to of steps) {
    current = await applyStageChange(tx, current, {
      to,
      actorId: ctx.actor.userId,
      via: "quote",
      columns: { twentySyncedAt: new Date(record.updatedAt) },
    });
  }
  return current;
}

/**
 * Un devis vient d'être accepté (lot Devis). À appeler dans sa transaction, droits déjà vérifiés.
 *
 * Idempotent : déjà gagnée, l'affaire reste telle quelle et aucun événement n'est répété. Le montant
 * manquant vient de la version acceptée. Une affaire perdue est refusée : l'accord du client ne vaut
 * pas réouverture, réservée à un associé. Si Twenty est coupé, l'erreur annule la transaction du
 * devis, qui se rejoue.
 */
export async function markOpportunityWon(
  ctx: ServiceContext,
  tx: Database,
  input: { opportunityId: string; quoteId: string },
): Promise<Opportunity> {
  let current = await repository.lockOpportunityById(tx, input.opportunityId);
  if (!current) throw new NotFoundError("Affaire introuvable.");
  if (current.stage === "WON") return current;
  if (current.stage === "LOST") {
    throw new ConflictError("Cette affaire est perdue : un associé doit la rouvrir d'abord.");
  }
  const quote = await repository.findQuoteOfOpportunity(tx, input.quoteId, input.opportunityId);
  if (!quote) throw new ConflictError("Ce devis n'appartient pas à cette affaire.");

  const amountCents = current.amountCents ?? quote.totalCents;
  const steps: OpportunityStage[] = [...WALK_TO_QUOTE_SENT[current.stage], "WON"];
  // En négociation, l'étape suivante est directement « Gagné ».
  if (current.stage === "NEGOTIATION") steps.shift();

  let from: OpportunityStage = current.stage;
  for (const to of steps) {
    assertOpportunityTransition(from, to, {
      role: ctx.actor.role,
      companyId: current.companyId,
      amountCents,
    });
    from = to;
  }

  assertCrmWritable(current.twentyId);
  const record = await requireCrm(ctx).updateOpportunity(current.twentyId, {
    stage: "WON",
    ...(current.amountCents === null ? { amount: amountFor(amountCents) ?? null } : {}),
  });
  const columns = { amountCents, twentySyncedAt: new Date(record.updatedAt) };
  for (const to of steps) {
    current = await applyStageChange(tx, current, {
      to,
      actorId: ctx.actor.userId,
      via: "quote",
      quoteId: to === "WON" ? input.quoteId : undefined,
      columns,
    });
  }
  return current;
}

export async function archiveOpportunity(ctx: ServiceContext, id: string): Promise<Opportunity> {
  assertCan(ctx.actor, "sales:update");
  const current = await repository.findOpportunityById(ctx.db, id);
  if (!current) throw new NotFoundError("Affaire introuvable.");
  if (current.archivedAt) return current;
  assertCrmWritable(current.twentyId);
  try {
    await requireCrm(ctx).deleteOpportunity(current.twentyId);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  return ctx.db.transaction(async (tx) => {
    const row = await repository.updateOpportunityRow(tx, id, { archivedAt: new Date() });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "opportunity.archived",
      entityType: "opportunity",
      entityId: id,
      metadata: { name: current.name, companyId: current.companyId },
    });
    return row;
  });
}

export async function restoreOpportunity(ctx: ServiceContext, id: string): Promise<Opportunity> {
  assertCan(ctx.actor, "sales:update");
  const current = await repository.findOpportunityById(ctx.db, id);
  if (!current) throw new NotFoundError("Affaire introuvable.");
  if (!current.archivedAt) return current;
  assertCrmWritable(current.twentyId);
  const record = await requireCrm(ctx).restoreOpportunity(current.twentyId);
  return ctx.db.transaction(async (tx) => {
    const row = await repository.updateOpportunityRow(tx, id, {
      ...opportunityTwentyColumns(record),
      archivedAt: null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "opportunity.restored",
      entityType: "opportunity",
      entityId: id,
      metadata: { name: current.name },
    });
    return row;
  });
}

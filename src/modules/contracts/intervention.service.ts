import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Contract, MaintenanceIntervention } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { paginated, type PageParams, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import { emitQuotaEvents } from "./contract-quota";
import { parisDay } from "./contract.rules";
import * as repository from "./contract.repository";
import {
  completeInterventionSchema,
  createInterventionSchema,
  updateInterventionSchema,
} from "./contract.schema";
import type { InterventionRow } from "./contract.types";

/**
 * Journal de maintenance (08.03) : opérations prévues au contrat, puis réalisées. Une intervention
 * ne consomme le forfait qu'une fois réalisée, sur la période de sa date de réalisation.
 */
async function lockActive(tx: Database, contractId: string): Promise<Contract> {
  const contract = await repository.lockContract(tx, contractId);
  if (!contract) throw new NotFoundError("Contrat introuvable.");
  if (contract.status === "terminated" || contract.status === "expired") {
    throw new ConflictError("Ce contrat est terminé : son journal est clos.");
  }
  return contract;
}

async function assertLinks(
  tx: Database,
  contract: Contract,
  data: { siteId: string | null; memberId: string | null },
): Promise<void> {
  if (data.siteId && !(await repository.findCompanySite(tx, data.siteId, contract.companyId))) {
    throw new NotFoundError("Site introuvable pour ce client.");
  }
  if (data.memberId && !(await repository.memberExists(tx, data.memberId))) {
    throw new NotFoundError("Intervenant introuvable.");
  }
}

/** Avant le début du contrat, une réalisation ne tomberait dans aucune période : rien ne la compterait. */
function assertWithinContract(doneOn: string, contract: Contract): void {
  if (contract.startOn && doneOn < contract.startOn) {
    throw new ValidationError("Cette date précède le début du contrat.", {
      doneOn: ["Choisissez une date à partir du début du contrat."],
    });
  }
}

function assertNotFuture(doneOn: string, today: string): void {
  if (doneOn > today) {
    throw new ValidationError("Une intervention réalisée ne peut pas être datée dans le futur.", {
      doneOn: ["Choisissez aujourd'hui ou une date passée."],
    });
  }
}

export async function listInterventions(
  ctx: ServiceContext,
  contractId: string,
  params: PageParams,
): Promise<Paginated<InterventionRow>> {
  assertCan(ctx.actor, "contracts:read");
  const contract = await repository.findContract(ctx.db, contractId);
  if (!contract) throw new NotFoundError("Contrat introuvable.");
  const { items, total } = await repository.listContractInterventions(ctx.db, contractId, params);
  if (items.length === 0 && total > 0 && params.page > 1) {
    // Une page au-delà de la dernière (adresse ancienne ou modifiée) retombe sur la dernière.
    const last = { ...params, page: Math.ceil(total / params.pageSize) };
    const lastPage = await repository.listContractInterventions(ctx.db, contractId, last);
    return paginated(lastPage.items, lastPage.total, last);
  }
  return paginated(items, total, params);
}

export async function createIntervention(
  ctx: ServiceContext,
  contractId: string,
  input: unknown,
  options: { now?: Date } = {},
): Promise<MaintenanceIntervention> {
  assertCan(ctx.actor, "contracts:update");
  const data = parseInput(createInterventionSchema, input);
  const today = parisDay(options.now ?? new Date());
  if (data.doneOn) assertNotFuture(data.doneOn, today);

  return ctx.db.transaction(async (tx) => {
    const contract = await lockActive(tx, contractId);
    await assertLinks(tx, contract, data);
    if (data.doneOn && contract.status === "to_start") {
      throw new ConflictError(
        "Ce contrat n'a pas démarré : l'intervention ne peut qu'être prévue.",
      );
    }
    if (data.doneOn) assertWithinContract(data.doneOn, contract);

    // Même envoi rejoué : la même ligne, sans décompter le forfait une seconde fois.
    const replayed = await repository.findSameIntervention(tx, {
      contractId,
      title: data.title,
      siteId: data.siteId,
      plannedOn: data.plannedOn,
      doneOn: data.doneOn,
      minutes: data.minutes,
    });
    if (replayed) return replayed;

    const intervention = await repository.insertIntervention(tx, {
      companyId: contract.companyId,
      contractId,
      siteId: data.siteId,
      memberId: data.memberId,
      title: data.title,
      plannedOn: data.plannedOn,
      doneOn: data.doneOn,
      result: data.doneOn ? data.result : null,
      minutes: data.minutes,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: data.doneOn ? "intervention.done" : "intervention.created",
      entityType: "intervention",
      entityId: intervention.id,
      metadata: { contractId, minutes: data.minutes },
    });
    if (data.doneOn) await emitQuotaEvents(tx, contract, data.doneOn, ctx.actor.userId);
    return intervention;
  });
}

export async function updateIntervention(
  ctx: ServiceContext,
  contractId: string,
  interventionId: string,
  input: unknown,
): Promise<MaintenanceIntervention> {
  assertCan(ctx.actor, "contracts:update");
  const data = parseInput(updateInterventionSchema, input);

  return ctx.db.transaction(async (tx) => {
    const contract = await lockActive(tx, contractId);
    const intervention = await repository.findIntervention(tx, interventionId, contractId);
    if (!intervention) throw new NotFoundError("Intervention introuvable.");
    if (intervention.doneOn) {
      throw new ConflictError("Une intervention réalisée fait preuve : elle ne se modifie plus.");
    }
    await assertLinks(tx, contract, data);

    const updated = await repository.updateIntervention(tx, interventionId, {
      title: data.title,
      siteId: data.siteId,
      memberId: data.memberId,
      plannedOn: data.plannedOn,
      minutes: data.minutes,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "intervention.updated",
      entityType: "intervention",
      entityId: interventionId,
      metadata: { contractId },
    });
    return updated;
  });
}

/** Réalise une intervention prévue. Déjà réalisée : rien ne change. */
export async function completeIntervention(
  ctx: ServiceContext,
  contractId: string,
  interventionId: string,
  input: unknown,
  options: { now?: Date } = {},
): Promise<MaintenanceIntervention> {
  assertCan(ctx.actor, "contracts:update");
  const data = parseInput(completeInterventionSchema, input);
  assertNotFuture(data.doneOn, parisDay(options.now ?? new Date()));

  return ctx.db.transaction(async (tx) => {
    const contract = await lockActive(tx, contractId);
    const intervention = await repository.findIntervention(tx, interventionId, contractId);
    if (!intervention) throw new NotFoundError("Intervention introuvable.");
    if (intervention.doneOn) return intervention;
    if (intervention.result) {
      throw new ConflictError("Cette intervention a été annulée.");
    }
    if (contract.status === "to_start") {
      throw new ConflictError("Ce contrat n'a pas démarré : démarrez-le d'abord.");
    }
    assertWithinContract(data.doneOn, contract);

    const updated = await repository.updateIntervention(tx, interventionId, {
      doneOn: data.doneOn,
      minutes: data.minutes,
      result: data.result,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "intervention.done",
      entityType: "intervention",
      entityId: interventionId,
      metadata: { contractId, minutes: data.minutes },
    });
    await emitQuotaEvents(tx, contract, data.doneOn, ctx.actor.userId);
    return updated;
  });
}

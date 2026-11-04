import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { MaintenancePlan } from "@/server/db/schema";
import { ConflictError, NotFoundError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import * as repository from "./contract.repository";
import { planSchema } from "./contract.schema";
import type { MaintenancePlanRow } from "./contract.types";

/** Formules de maintenance : modèles copiés dans un contrat à sa création, jamais supprimés. */
export async function listMaintenancePlans(
  ctx: ServiceContext,
  options: { activeOnly?: boolean } = {},
): Promise<MaintenancePlanRow[]> {
  assertCan(ctx.actor, "contracts:read");
  return repository.listPlans(ctx.db, { activeOnly: options.activeOnly ?? false });
}

const DUPLICATE_NAME = {
  message: "Une formule porte déjà ce nom.",
  fields: { name: ["Une formule porte déjà ce nom."] },
};

export async function createMaintenancePlan(
  ctx: ServiceContext,
  input: unknown,
): Promise<MaintenancePlan> {
  assertCan(ctx.actor, "contracts:create");
  const data = parseInput(planSchema, input);
  return ctx.db.transaction(async (tx) => {
    if (await repository.planNamed(tx, data.name)) {
      throw new ConflictError(DUPLICATE_NAME.message, DUPLICATE_NAME.fields);
    }
    const plan = await repository.insertPlan(tx, data);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "maintenance_plan.created",
      entityType: "maintenance_plan",
      entityId: plan.id,
      metadata: { name: plan.name },
    });
    return plan;
  });
}

export async function updateMaintenancePlan(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<MaintenancePlan> {
  assertCan(ctx.actor, "contracts:update");
  const data = parseInput(planSchema, input);
  return ctx.db.transaction(async (tx) => {
    if (!(await repository.findPlan(tx, id))) throw new NotFoundError("Formule introuvable.");
    if (await repository.planNamed(tx, data.name, id)) {
      throw new ConflictError(DUPLICATE_NAME.message, DUPLICATE_NAME.fields);
    }
    const plan = await repository.updatePlan(tx, id, data);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "maintenance_plan.updated",
      entityType: "maintenance_plan",
      entityId: id,
      metadata: { name: plan.name },
    });
    return plan;
  });
}

/** Retirer une formule ne touche pas ses contrats : ils ont leur propre copie des conditions. */
export async function setMaintenancePlanActive(
  ctx: ServiceContext,
  id: string,
  active: boolean,
): Promise<MaintenancePlan> {
  assertCan(ctx.actor, "contracts:update");
  return ctx.db.transaction(async (tx) => {
    const plan = await repository.findPlan(tx, id);
    if (!plan) throw new NotFoundError("Formule introuvable.");
    if (plan.active === active) return plan;
    const updated = await repository.updatePlan(tx, id, { active });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "maintenance_plan.updated",
      entityType: "maintenance_plan",
      entityId: id,
      metadata: { name: plan.name, active },
    });
    return updated;
  });
}

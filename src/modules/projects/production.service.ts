import { recordAudit } from "@/modules/audit/audit.service";
import { emitEvent } from "@/modules/platform/events";
import { nextNumber } from "@/modules/platform/sequences";
import { assertCan, assertCanAny } from "@/server/auth/permissions";
import type { PortalContext, ServiceContext } from "@/server/context";
import type {
  ChangeRequest,
  ClientRequirement,
  Deliverable,
  DeliverableReview,
  HandoverChecklistItem,
  Project,
  ProjectBlocker,
  ProjectPhase,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { z } from "@/lib/zod";
import { assertChangeRequestTransition } from "./change-request.status";
import { assertDeliverableTransition } from "./deliverable.status";
import { assertPhaseTransition } from "./phase.status";
import {
  assertProjectEditable,
  lockEditableProject,
  lockExistingProject,
  requireReadableProject,
} from "./project.access";
import * as repository from "./project.repository";
import {
  addHandoverItemSchema,
  changePhaseStatusSchema,
  changeRequestDecisionSchema,
  companyRowsSchema,
  createChangeRequestSchema,
  createDeliverableSchema,
  createPhaseSchema,
  createRequirementSchema,
  deliverableReviewSchema,
  markRequirementReceivedSchema,
  newDeliverableVersionSchema,
  raiseBlockerSchema,
  reopenRequirementSchema,
  resolveBlockerSchema,
  submitDeliverableSchema,
  toggleHandoverItemSchema,
  updateBlockerSchema,
  updateChangeRequestSchema,
  updateDeliverableSchema,
  updatePhaseSchema,
  updateRequirementSchema,
  type CreateChangeRequestInput,
  type DeliverableReviewInput,
  type MarkRequirementReceivedInput,
  type SubmitDeliverableInput,
} from "./project.schema";
import * as production from "./production.repository";
import * as taskRepository from "./task.repository";

function isPortal(ctx: ServiceContext | PortalContext): ctx is PortalContext {
  return "companyId" in ctx;
}

/**
 * Dans la transaction de l'appelant, tout passe par elle, lectures comprises : une lecture hors
 * transaction ne verrait pas ses écritures, et attendrait sa fin sur une connexion unique.
 */
function withTransaction<TContext extends ServiceContext | PortalContext>(
  ctx: TContext,
  tx: Database | undefined,
): TContext {
  return tx ? { ...ctx, db: tx } : ctx;
}

async function requireEditableProject(ctx: ServiceContext, projectId: string): Promise<Project> {
  assertCan(ctx.actor, "projects:update");
  const project = await requireReadableProject(ctx, projectId);
  assertProjectEditable(project);
  return project;
}

async function assertDocumentInProject(
  db: Database,
  documentId: string | null | undefined,
  projectId: string,
): Promise<void> {
  if (!documentId) return;
  if (!(await repository.documentBelongsToProject(db, documentId, projectId))) {
    throw new ValidationError("Ce document n'est pas rattaché au projet.", {
      documentId: ["Ce document n'est pas rattaché au projet."],
    });
  }
}

async function assertPhaseInProject(
  db: Database,
  phaseId: string | null | undefined,
  projectId: string,
): Promise<void> {
  if (!phaseId) return;
  const phase = await production.findPhase(db, phaseId);
  if (!phase || phase.projectId !== projectId) {
    throw new ValidationError("Ce jalon n'appartient pas au projet.", {
      phaseId: ["Ce jalon n'appartient pas au projet."],
    });
  }
}

// --- Jalons ------------------------------------------------------------------------------------

export async function createPhase(
  ctx: ServiceContext,
  input: { projectId: string; name: string; dueOn?: string | null; clientVisible?: unknown },
): Promise<ProjectPhase> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(createPhaseSchema, input);
  await requireEditableProject(ctx, parsed.projectId);
  return ctx.db.transaction(async (tx) => {
    const position = await production.nextPhasePosition(tx, parsed.projectId);
    const [phase] = await production.insertPhases(tx, [
      {
        projectId: parsed.projectId,
        name: parsed.name,
        dueOn: parsed.dueOn ?? null,
        clientVisible: parsed.clientVisible,
        position,
      },
    ]);
    if (!phase) throw new Error("Jalon non créé.");
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "project_phase.created",
      entityType: "project_phase",
      entityId: phase.id,
      metadata: { name: phase.name, projectId: parsed.projectId },
    });
    return phase;
  });
}

export async function updatePhase(
  ctx: ServiceContext,
  input: { phaseId: string; name: string; dueOn?: string | null; clientVisible?: unknown },
): Promise<ProjectPhase> {
  assertCan(ctx.actor, "projects:update");
  const { phaseId, ...parsed } = parseInput(updatePhaseSchema, input);
  const phase = await production.findPhase(ctx.db, phaseId);
  if (!phase) throw new NotFoundError("Jalon introuvable.");
  await requireEditableProject(ctx, phase.projectId);
  return ctx.db.transaction(async (tx) => {
    const updated = await production.updatePhase(tx, phaseId, {
      name: parsed.name,
      dueOn: parsed.dueOn ?? null,
      clientVisible: parsed.clientVisible,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "project_phase.updated",
      entityType: "project_phase",
      entityId: phaseId,
      metadata: { name: updated.name, dueOn: updated.dueOn },
    });
    return updated;
  });
}

/**
 * Change l'état d'un jalon selon la machine. Terminer un jalon éclaire le suivant (note de
 * l'écran 17) : l'étape vue par le client le suit.
 */
export async function changePhaseStatus(
  ctx: ServiceContext,
  input: { phaseId: string; status: ProjectPhase["status"] },
): Promise<ProjectPhase> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(changePhaseStatusSchema, input);
  const phase = await production.findPhase(ctx.db, parsed.phaseId);
  if (!phase) throw new NotFoundError("Jalon introuvable.");
  await requireEditableProject(ctx, phase.projectId);

  return ctx.db.transaction(async (tx) => {
    await lockEditableProject(tx, phase.projectId);
    const fresh = await production.findPhase(tx, phase.id);
    if (!fresh) throw new NotFoundError("Jalon introuvable.");
    if (fresh.status === parsed.status) return fresh;
    assertPhaseTransition(fresh.status, parsed.status);

    const updated = await production.updatePhase(tx, phase.id, { status: parsed.status });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "project_phase.updated",
      entityType: "project_phase",
      entityId: phase.id,
      metadata: { name: fresh.name, from: fresh.status, to: parsed.status },
    });

    const phases = await production.listPhases(tx, phase.projectId);
    let current = phases.find((item) => item.status === "in_progress");
    if (parsed.status === "done" && !current) {
      const next = phases.find((item) => item.status === "todo");
      if (next) {
        current = await production.updatePhase(tx, next.id, { status: "in_progress" });
        await recordAudit(tx, {
          actorId: ctx.actor.userId,
          action: "project_phase.updated",
          entityType: "project_phase",
          entityId: next.id,
          metadata: { name: next.name, from: "todo", to: "in_progress" },
        });
      }
    }
    if (current) {
      await repository.updateProject(tx, phase.projectId, { clientStepLabel: current.name });
    }
    return updated;
  });
}

// --- Livrables ---------------------------------------------------------------------------------

export async function createDeliverable(
  ctx: ServiceContext,
  input: Record<string, unknown>,
): Promise<Deliverable> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(createDeliverableSchema, input);
  await requireEditableProject(ctx, parsed.projectId);
  await assertPhaseInProject(ctx.db, parsed.phaseId, parsed.projectId);
  await assertDocumentInProject(ctx.db, parsed.documentId, parsed.projectId);
  return ctx.db.transaction(async (tx) => {
    const deliverable = await production.insertDeliverable(tx, {
      projectId: parsed.projectId,
      title: parsed.title,
      phaseId: parsed.phaseId ?? null,
      documentId: parsed.documentId ?? null,
      requiresClientValidation: parsed.requiresClientValidation,
      feedbackRoundsIncluded: parsed.feedbackRoundsIncluded,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "deliverable.created",
      entityType: "deliverable",
      entityId: deliverable.id,
      metadata: { title: deliverable.title, projectId: parsed.projectId },
    });
    return deliverable;
  });
}

async function requireDeliverableForAgency(
  ctx: ServiceContext,
  deliverableId: string,
): Promise<production.DeliverableScopeRow> {
  assertCan(ctx.actor, "projects:update");
  const scope = await production.findDeliverableScope(ctx.db, deliverableId);
  if (!scope) throw new NotFoundError("Livrable introuvable.");
  await requireEditableProject(ctx, scope.deliverable.projectId);
  return scope;
}

async function requireFreshDeliverable(tx: Database, deliverableId: string): Promise<Deliverable> {
  const scope = await production.findDeliverableScope(tx, deliverableId);
  if (!scope) throw new NotFoundError("Livrable introuvable.");
  return scope.deliverable;
}

export async function updateDeliverable(
  ctx: ServiceContext,
  input: Record<string, unknown>,
): Promise<Deliverable> {
  assertCan(ctx.actor, "projects:update");
  const { deliverableId, ...parsed } = parseInput(updateDeliverableSchema, input);
  const { deliverable } = await requireDeliverableForAgency(ctx, deliverableId);
  await assertPhaseInProject(ctx.db, parsed.phaseId, deliverable.projectId);
  await assertDocumentInProject(ctx.db, parsed.documentId, deliverable.projectId);
  if (deliverable.status === "to_validate" || deliverable.status === "validated") {
    const documentChanged = (parsed.documentId ?? null) !== deliverable.documentId;
    if (documentChanged) {
      throw new ConflictError(
        "Le document d'une version soumise ne change plus : créez une nouvelle version.",
      );
    }
  }
  if (
    deliverable.status === "to_validate" &&
    deliverable.requiresClientValidation &&
    !parsed.requiresClientValidation
  ) {
    throw new ConflictError(
      "Ce livrable attend la validation du client : enregistrez sa décision avant de la retirer.",
    );
  }
  return ctx.db.transaction(async (tx) => {
    const updated = await production.updateDeliverable(tx, deliverableId, {
      title: parsed.title,
      phaseId: parsed.phaseId ?? null,
      documentId: parsed.documentId ?? null,
      requiresClientValidation: parsed.requiresClientValidation,
      feedbackRoundsIncluded: parsed.feedbackRoundsIncluded,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "deliverable.updated",
      entityType: "deliverable",
      entityId: deliverableId,
      metadata: {
        title: updated.title,
        requiresClientValidation: updated.requiresClientValidation,
      },
    });
    return updated;
  });
}

/**
 * Soumet un livrable à validation. Après des retours, la soumission crée la version suivante.
 * Répéter sur un livrable déjà soumis ne fait rien. `tx` : transaction de l'appelant.
 */
export async function submitDeliverable(
  ctx: ServiceContext,
  input: SubmitDeliverableInput,
  options: { tx?: Database } = {},
): Promise<Deliverable> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(submitDeliverableSchema, input);
  const scoped = withTransaction(ctx, options.tx);
  const {
    deliverable: { projectId },
    companyId,
  } = await requireDeliverableForAgency(scoped, parsed.deliverableId);
  await assertDocumentInProject(scoped.db, parsed.documentId, projectId);

  return scoped.db.transaction(async (tx) => {
    await lockEditableProject(tx, projectId);
    const deliverable = await requireFreshDeliverable(tx, parsed.deliverableId);
    if (deliverable.status === "to_validate") return deliverable;
    assertDeliverableTransition(deliverable.status, "to_validate");
    const version =
      deliverable.status === "changes_requested" ? deliverable.version + 1 : deliverable.version;
    const updated = await production.updateDeliverable(tx, deliverable.id, {
      status: "to_validate",
      version,
      documentId: parsed.documentId === undefined ? deliverable.documentId : parsed.documentId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "deliverable.submitted",
      entityType: "deliverable",
      entityId: deliverable.id,
      metadata: { title: deliverable.title, version, projectId: deliverable.projectId },
    });
    await emitEvent(tx, {
      type: "deliverable.submitted",
      entityType: "deliverable",
      entityId: deliverable.id,
      companyId,
      payload: { projectId: deliverable.projectId, title: deliverable.title, version },
      actorId: ctx.actor.userId,
      dedupeKey: `deliverable.submitted:${deliverable.id}:${version}`,
    });
    return updated;
  });
}

/** Un livrable validé repart en brouillon pour une nouvelle version : l'ancienne reste au journal. */
export async function startDeliverableVersion(
  ctx: ServiceContext,
  input: { deliverableId: string; documentId?: string | null },
): Promise<Deliverable> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(newDeliverableVersionSchema, input);
  const {
    deliverable: { projectId, status },
  } = await requireDeliverableForAgency(ctx, parsed.deliverableId);
  assertDeliverableTransition(status, "draft");
  await assertDocumentInProject(ctx.db, parsed.documentId, projectId);
  return ctx.db.transaction(async (tx) => {
    await lockEditableProject(tx, projectId);
    const deliverable = await requireFreshDeliverable(tx, parsed.deliverableId);
    // Une seconde demande arrive après la première : le brouillon existe déjà.
    if (deliverable.status === "draft") return deliverable;
    assertDeliverableTransition(deliverable.status, "draft");
    const version = deliverable.version + 1;
    const updated = await production.updateDeliverable(tx, deliverable.id, {
      status: "draft",
      version,
      documentId: parsed.documentId === undefined ? deliverable.documentId : parsed.documentId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "deliverable.updated",
      entityType: "deliverable",
      entityId: deliverable.id,
      metadata: { title: deliverable.title, version },
    });
    return updated;
  });
}

export interface DeliverableReviewResult {
  review: DeliverableReview;
  deliverable: Deliverable;
  /** Demande de changement ouverte quand les tours de retours inclus sont dépassés. */
  outOfScopeChangeRequest: ChangeRequest | null;
}

/**
 * Enregistre la décision sur la version soumise. Appelable par l'agence (`ServiceContext`, droit
 * `projects:update`) ou par le client (`PortalContext` : son `companyId` seul, livrables à valider
 * par lui seuls, sinon 404). Répéter la même décision renvoie la décision déjà enregistrée.
 * `tx` : transaction de l'appelant.
 */
export async function recordDeliverableReview(
  ctx: ServiceContext | PortalContext,
  input: DeliverableReviewInput,
  options: { tx?: Database } = {},
): Promise<DeliverableReviewResult> {
  const portal = isPortal(ctx);
  if (!portal) assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(deliverableReviewSchema, input);
  const scoped = withTransaction(ctx, options.tx);
  const scope = await production.findDeliverableScope(scoped.db, parsed.deliverableId);
  if (!scope) throw new NotFoundError("Livrable introuvable.");
  const { companyId } = scope;
  const { projectId } = scope.deliverable;

  if (isPortal(scoped)) {
    if (companyId !== scoped.companyId || !scope.deliverable.requiresClientValidation) {
      throw new NotFoundError("Livrable introuvable.");
    }
    if (scope.projectArchivedAt || scope.projectStatus === "closed") {
      throw new NotFoundError("Livrable introuvable.");
    }
  } else {
    await requireEditableProject(scoped, projectId);
  }

  return scoped.db.transaction(async (tx) => {
    // Relu sous verrou : une décision envoyée deux fois voit la première et s'arrête là.
    await lockExistingProject(tx, projectId);
    const deliverable = await requireFreshDeliverable(tx, parsed.deliverableId);
    if (deliverable.status !== "to_validate") {
      const last = await production.findReviewOfVersion(tx, deliverable.id, deliverable.version);
      if (last && last.decision === parsed.decision) {
        return { review: last, deliverable, outOfScopeChangeRequest: null };
      }
    }
    assertDeliverableTransition(deliverable.status, parsed.decision);
    const version = deliverable.version;

    const review = await production.insertReview(tx, {
      deliverableId: deliverable.id,
      version,
      decision: parsed.decision,
      comment: parsed.comment ?? null,
      reviewerUserId: ctx.actor.userId,
    });
    const updated = await production.updateDeliverable(tx, deliverable.id, {
      status: parsed.decision,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: portal
        ? "portal.deliverable_reviewed"
        : parsed.decision === "validated"
          ? "deliverable.validated"
          : "deliverable.changes_requested",
      entityType: "deliverable",
      entityId: deliverable.id,
      metadata: { title: deliverable.title, version, decision: parsed.decision },
    });
    const payload = { projectId: deliverable.projectId, title: deliverable.title, version };
    const actorId = ctx.actor.userId;
    if (parsed.decision === "validated") {
      await emitEvent(tx, {
        type: "deliverable.validated",
        entityType: "deliverable",
        entityId: deliverable.id,
        companyId,
        payload,
        actorId,
        dedupeKey: `deliverable.validated:${deliverable.id}:${version}`,
      });
    } else {
      await emitEvent(tx, {
        type: "deliverable.changes_requested",
        entityType: "deliverable",
        entityId: deliverable.id,
        companyId,
        payload,
        actorId,
        dedupeKey: `deliverable.changes_requested:${deliverable.id}:${version}`,
      });
    }

    let outOfScopeChangeRequest: ChangeRequest | null = null;
    if (parsed.decision === "changes_requested" && deliverable.feedbackRoundsIncluded > 0) {
      const rounds = await production.countChangeRounds(tx, deliverable.id);
      if (rounds > deliverable.feedbackRoundsIncluded) {
        outOfScopeChangeRequest = await production.insertChangeRequest(tx, {
          companyId,
          projectId: deliverable.projectId,
          title: `Tour de retours supplémentaire : ${deliverable.title}`,
          description: `${rounds} tours demandés pour ${deliverable.feedbackRoundsIncluded} inclus (version ${version}).`,
        });
        await recordAudit(tx, {
          actorId,
          action: "change_request.created",
          entityType: "change_request",
          entityId: outOfScopeChangeRequest.id,
          metadata: { deliverableId: deliverable.id, rounds },
        });
      }
    }
    return { review, deliverable: updated, outOfScopeChangeRequest };
  });
}

// --- Contenus attendus -------------------------------------------------------------------------

export async function createRequirement(
  ctx: ServiceContext,
  input: { projectId: string; label: string; dueOn?: string | null },
): Promise<ClientRequirement> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(createRequirementSchema, input);
  await requireEditableProject(ctx, parsed.projectId);
  return ctx.db.transaction(async (tx) => {
    const requirement = await production.insertRequirement(tx, {
      projectId: parsed.projectId,
      label: parsed.label,
      dueOn: parsed.dueOn ?? null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "client_requirement.created",
      entityType: "client_requirement",
      entityId: requirement.id,
      metadata: { label: requirement.label, projectId: parsed.projectId },
    });
    return requirement;
  });
}

async function requireRequirementForAgency(
  ctx: ServiceContext,
  requirementId: string,
): Promise<production.RequirementScopeRow> {
  assertCan(ctx.actor, "projects:update");
  const scope = await production.findRequirementScope(ctx.db, requirementId);
  if (!scope) throw new NotFoundError("Contenu attendu introuvable.");
  await requireEditableProject(ctx, scope.requirement.projectId);
  return scope;
}

export async function updateRequirement(
  ctx: ServiceContext,
  input: { requirementId: string; label: string; dueOn?: string | null },
): Promise<ClientRequirement> {
  assertCan(ctx.actor, "projects:update");
  const { requirementId, ...parsed } = parseInput(updateRequirementSchema, input);
  await requireRequirementForAgency(ctx, requirementId);
  return ctx.db.transaction(async (tx) => {
    const updated = await production.updateRequirement(tx, requirementId, {
      label: parsed.label,
      dueOn: parsed.dueOn ?? null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "client_requirement.updated",
      entityType: "client_requirement",
      entityId: requirementId,
      metadata: { label: updated.label },
    });
    return updated;
  });
}

/**
 * Marque un contenu comme reçu, depuis l'agence ou depuis l'espace client (`PortalContext` : son
 * `companyId` seul, sinon 404). Répéter sur un contenu déjà reçu ne fait rien.
 */
export async function markRequirementReceived(
  ctx: ServiceContext | PortalContext,
  input: MarkRequirementReceivedInput,
  options: { tx?: Database } = {},
): Promise<ClientRequirement> {
  const portal = isPortal(ctx);
  if (!portal) assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(markRequirementReceivedSchema, input);
  const scoped = withTransaction(ctx, options.tx);
  const scope = await production.findRequirementScope(scoped.db, parsed.requirementId);
  if (!scope) throw new NotFoundError("Contenu attendu introuvable.");
  const { requirement } = scope;

  if (isPortal(scoped)) {
    if (
      scope.companyId !== scoped.companyId ||
      scope.projectArchivedAt ||
      scope.projectStatus === "closed"
    ) {
      throw new NotFoundError("Contenu attendu introuvable.");
    }
  } else {
    await requireEditableProject(scoped, requirement.projectId);
  }
  await assertDocumentInProject(scoped.db, parsed.documentId, requirement.projectId);

  return scoped.db.transaction(async (tx) => {
    await lockExistingProject(tx, requirement.projectId);
    const fresh = await production.findRequirementScope(tx, requirement.id);
    if (!fresh) throw new NotFoundError("Contenu attendu introuvable.");
    if (fresh.requirement.status === "received") return fresh.requirement;
    const updated = await production.updateRequirement(tx, requirement.id, {
      status: "received",
      receivedAt: new Date(),
      documentId: parsed.documentId ?? fresh.requirement.documentId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "client_requirement.received",
      entityType: "client_requirement",
      entityId: requirement.id,
      metadata: { label: requirement.label, projectId: requirement.projectId, portal },
    });
    return updated;
  });
}

/** Annule une réception saisie par erreur. */
export async function reopenRequirement(
  ctx: ServiceContext,
  input: { requirementId: string },
): Promise<ClientRequirement> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(reopenRequirementSchema, input);
  const { requirement } = await requireRequirementForAgency(ctx, parsed.requirementId);
  return ctx.db.transaction(async (tx) => {
    await lockEditableProject(tx, requirement.projectId);
    const fresh = await production.findRequirementScope(tx, requirement.id);
    if (!fresh) throw new NotFoundError("Contenu attendu introuvable.");
    if (fresh.requirement.status === "expected") return fresh.requirement;
    const updated = await production.updateRequirement(tx, requirement.id, {
      status: "expected",
      receivedAt: null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "client_requirement.updated",
      entityType: "client_requirement",
      entityId: requirement.id,
      metadata: { label: requirement.label, from: "received", to: "expected" },
    });
    return updated;
  });
}

// --- Blocages ----------------------------------------------------------------------------------

export async function raiseBlocker(
  ctx: ServiceContext,
  input: {
    projectId: string;
    title: string;
    consequence?: string | null;
    decision?: string | null;
  },
): Promise<ProjectBlocker> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(raiseBlockerSchema, input);
  await requireEditableProject(ctx, parsed.projectId);
  return ctx.db.transaction(async (tx) => {
    await lockEditableProject(tx, parsed.projectId);
    const blocker = await production.insertBlocker(tx, {
      projectId: parsed.projectId,
      title: parsed.title,
      consequence: parsed.consequence ?? null,
      decision: parsed.decision ?? null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "project_blocker.raised",
      entityType: "project_blocker",
      entityId: blocker.id,
      metadata: { title: blocker.title, projectId: parsed.projectId },
    });
    return blocker;
  });
}

export async function updateBlocker(
  ctx: ServiceContext,
  input: {
    blockerId: string;
    title: string;
    consequence?: string | null;
    decision?: string | null;
  },
): Promise<ProjectBlocker> {
  assertCan(ctx.actor, "projects:update");
  const { blockerId, ...parsed } = parseInput(updateBlockerSchema, input);
  const blocker = await production.findBlocker(ctx.db, blockerId);
  if (!blocker) throw new NotFoundError("Blocage introuvable.");
  await requireEditableProject(ctx, blocker.projectId);
  return ctx.db.transaction(async (tx) => {
    const updated = await production.updateBlocker(tx, blockerId, {
      title: parsed.title,
      consequence: parsed.consequence ?? null,
      decision: parsed.decision ?? null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "project_blocker.updated",
      entityType: "project_blocker",
      entityId: blockerId,
      metadata: { title: updated.title },
    });
    return updated;
  });
}

/** Lève un blocage. Répéter ne fait rien. */
export async function resolveBlocker(
  ctx: ServiceContext,
  input: { blockerId: string },
): Promise<ProjectBlocker> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(resolveBlockerSchema, input);
  const blocker = await production.findBlocker(ctx.db, parsed.blockerId);
  if (!blocker) throw new NotFoundError("Blocage introuvable.");
  await requireEditableProject(ctx, blocker.projectId);
  return ctx.db.transaction(async (tx) => {
    await lockEditableProject(tx, blocker.projectId);
    const fresh = await production.findBlocker(tx, blocker.id);
    if (!fresh) throw new NotFoundError("Blocage introuvable.");
    if (fresh.resolvedAt) return fresh;
    const updated = await production.updateBlocker(tx, blocker.id, { resolvedAt: new Date() });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "project_blocker.resolved",
      entityType: "project_blocker",
      entityId: blocker.id,
      metadata: { title: blocker.title },
    });
    return updated;
  });
}

// --- Demandes de changement --------------------------------------------------------------------

/**
 * Crée une demande de changement, hors périmètre du projet, sur un projet ou un client. Depuis un
 * ticket (parcours 3), une demande encore vivante est renvoyée plutôt que dupliquée.
 */
export async function createChangeRequest(
  ctx: ServiceContext,
  input: CreateChangeRequestInput,
): Promise<ChangeRequest> {
  assertCanAny(ctx.actor, ["projects:update", "support:update"]);
  const parsed = parseInput(createChangeRequestSchema, input);

  let companyId = parsed.companyId ?? null;
  if (parsed.projectId) {
    const project = await requireReadableProject(ctx, parsed.projectId);
    assertProjectEditable(project);
    if (companyId && companyId !== project.companyId) {
      throw new ConflictError("Ce projet appartient à un autre client.");
    }
    companyId = project.companyId;
  }
  if (!companyId) throw new ValidationError("Une demande est rattachée à un client.");
  if (!parsed.projectId && !(await repository.companyExists(ctx.db, companyId))) {
    throw new ValidationError("Ce client n'existe pas.", {
      companyId: ["Ce client n'existe pas."],
    });
  }

  if (parsed.ticketId) {
    const ticket = await production.companyOfTicket(ctx.db, parsed.ticketId);
    if (!ticket) throw new NotFoundError("Demande de support introuvable.");
    if (ticket.companyId !== companyId) {
      throw new ConflictError("Ce ticket appartient à un autre client.");
    }
  }

  const ownerCompanyId = companyId;
  return ctx.db.transaction(async (tx) => {
    if (parsed.ticketId) {
      await production.lockTicket(tx, parsed.ticketId);
      const live = await production.findLiveChangeRequestOfTicket(tx, parsed.ticketId);
      if (live) return live;
    }
    const changeRequest = await production.insertChangeRequest(tx, {
      companyId: ownerCompanyId,
      projectId: parsed.projectId ?? null,
      ticketId: parsed.ticketId ?? null,
      title: parsed.title,
      description: parsed.description ?? null,
      estimatedMinutes: parsed.estimatedMinutes ?? null,
      amountCents: parsed.amountCents ?? null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "change_request.created",
      entityType: "change_request",
      entityId: changeRequest.id,
      metadata: {
        title: changeRequest.title,
        projectId: changeRequest.projectId,
        ticketId: changeRequest.ticketId,
      },
    });
    return changeRequest;
  });
}

export async function requireOpenChangeRequest(
  ctx: ServiceContext,
  changeRequestId: string,
): Promise<ChangeRequest> {
  assertCan(ctx.actor, "projects:update");
  const changeRequest = await production.findChangeRequest(ctx.db, changeRequestId);
  if (!changeRequest) throw new NotFoundError("Demande de changement introuvable.");
  if (changeRequest.projectId) {
    await requireEditableProject(ctx, changeRequest.projectId);
  }
  return changeRequest;
}

async function requireLockedChangeRequest(
  tx: Database,
  changeRequestId: string,
): Promise<ChangeRequest> {
  const changeRequest = await production.lockChangeRequest(tx, changeRequestId);
  if (!changeRequest) throw new NotFoundError("Demande de changement introuvable.");
  return changeRequest;
}

export async function updateChangeRequest(
  ctx: ServiceContext,
  input: Record<string, unknown>,
): Promise<ChangeRequest> {
  assertCan(ctx.actor, "projects:update");
  const { changeRequestId, ...parsed } = parseInput(updateChangeRequestSchema, input);
  const changeRequest = await requireOpenChangeRequest(ctx, changeRequestId);
  if (changeRequest.status !== "open") {
    throw new ConflictError("Une demande tranchée ne se modifie plus.");
  }
  return ctx.db.transaction(async (tx) => {
    const updated = await production.updateChangeRequest(tx, changeRequestId, {
      title: parsed.title,
      description: parsed.description ?? null,
      estimatedMinutes: parsed.estimatedMinutes ?? null,
      amountCents: parsed.amountCents ?? null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "change_request.updated",
      entityType: "change_request",
      entityId: changeRequestId,
      metadata: { title: updated.title },
    });
    return updated;
  });
}

/**
 * Accepte les travaux dans le projet : une tâche est créée, l'enveloppe vendue et le budget
 * augmentent d'autant. Répéter sur une demande déjà acceptée ne fait rien.
 */
export async function acceptChangeRequest(
  ctx: ServiceContext,
  input: { changeRequestId: string },
): Promise<ChangeRequest> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(changeRequestDecisionSchema, input);
  const { projectId } = await requireOpenChangeRequest(ctx, parsed.changeRequestId);

  return ctx.db.transaction(async (tx) => {
    const project = projectId ? await lockEditableProject(tx, projectId) : null;
    const changeRequest = await requireLockedChangeRequest(tx, parsed.changeRequestId);
    if (changeRequest.status === "accepted") return changeRequest;
    assertChangeRequestTransition(changeRequest.status, "accepted");

    let taskId: string | null = null;
    if (project) {
      const task = await taskRepository.insertTask(tx, {
        number: await nextNumber(tx, "task"),
        projectId: project.id,
        title: changeRequest.title,
        description: changeRequest.description,
        estimatedMinutes: changeRequest.estimatedMinutes,
        position: await taskRepository.nextTaskPosition(tx, project.id),
      });
      taskId = task.id;
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "task.created",
        entityType: "task",
        entityId: task.id,
        metadata: { number: task.number, title: task.title, changeRequestId: changeRequest.id },
      });
      if (changeRequest.estimatedMinutes || changeRequest.amountCents) {
        await repository.updateProject(tx, project.id, {
          estimatedMinutes:
            (project.estimatedMinutes ?? 0) + (changeRequest.estimatedMinutes ?? 0) || null,
          budgetCents: (project.budgetCents ?? 0) + (changeRequest.amountCents ?? 0) || null,
        });
      }
    }
    const updated = await production.updateChangeRequest(tx, changeRequest.id, {
      status: "accepted",
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "change_request.accepted",
      entityType: "change_request",
      entityId: changeRequest.id,
      metadata: { title: changeRequest.title, taskId, amountCents: changeRequest.amountCents },
    });
    return updated;
  });
}

export async function refuseChangeRequest(
  ctx: ServiceContext,
  input: { changeRequestId: string },
): Promise<ChangeRequest> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(changeRequestDecisionSchema, input);
  await requireOpenChangeRequest(ctx, parsed.changeRequestId);
  return ctx.db.transaction(async (tx) => {
    const changeRequest = await requireLockedChangeRequest(tx, parsed.changeRequestId);
    if (changeRequest.status === "refused") return changeRequest;
    assertChangeRequestTransition(changeRequest.status, "refused");
    const updated = await production.updateChangeRequest(tx, changeRequest.id, {
      status: "refused",
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "change_request.refused",
      entityType: "change_request",
      entityId: changeRequest.id,
      metadata: { title: changeRequest.title },
    });
    return updated;
  });
}

/**
 * Rattache le devis issu d'une demande et la marque transformée. Répéter avec le même devis ne
 * fait rien ; un devis d'un autre client est refusé.
 */
export async function linkChangeRequestQuote(
  ctx: ServiceContext,
  input: { changeRequestId: string; quoteId: string },
): Promise<ChangeRequest> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(z.object({ changeRequestId: z.uuid(), quoteId: z.uuid() }), input);
  await requireOpenChangeRequest(ctx, parsed.changeRequestId);
  return ctx.db.transaction(async (tx) => {
    const changeRequest = await requireLockedChangeRequest(tx, parsed.changeRequestId);
    if (changeRequest.status === "converted" && changeRequest.quoteId === parsed.quoteId) {
      return changeRequest;
    }
    assertChangeRequestTransition(changeRequest.status, "converted");
    const quote = await production.findQuoteCompany(tx, parsed.quoteId);
    if (!quote) throw new NotFoundError("Devis introuvable.");
    if (quote.companyId !== changeRequest.companyId) {
      throw new ConflictError("Ce devis appartient à un autre client.");
    }
    const updated = await production.updateChangeRequest(tx, changeRequest.id, {
      status: "converted",
      quoteId: parsed.quoteId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "change_request.converted",
      entityType: "change_request",
      entityId: changeRequest.id,
      metadata: { title: changeRequest.title, quoteId: parsed.quoteId },
    });
    return updated;
  });
}

export interface CompanyChangeRequestRow {
  id: string;
  title: string;
  status: ChangeRequest["status"];
  projectId: string | null;
  ticketId: string | null;
  amountCents: number | null;
  estimatedMinutes: number | null;
  createdAt: Date;
}

/** Demandes de changement d'un client, pour la fiche 360°. */
export async function listChangeRequestsForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<CompanyChangeRequestRow[]> {
  assertCanAny(ctx.actor, ["projects:read", "support:read"]);
  const parsed = parseInput(companyRowsSchema, { companyId, limit: options.limit });
  const rows = await production.listChangeRequestsOfCompany(ctx.db, parsed);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    projectId: row.projectId,
    ticketId: row.ticketId,
    amountCents: row.amountCents,
    estimatedMinutes: row.estimatedMinutes,
    createdAt: row.createdAt,
  }));
}

// --- Passation ---------------------------------------------------------------------------------

export async function addHandoverItem(
  ctx: ServiceContext,
  input: { projectId: string; label: string },
): Promise<HandoverChecklistItem> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(addHandoverItemSchema, input);
  await requireEditableProject(ctx, parsed.projectId);
  return ctx.db.transaction(async (tx) => {
    await lockEditableProject(tx, parsed.projectId);
    const [item] = await production.insertHandoverItems(tx, [
      {
        projectId: parsed.projectId,
        label: parsed.label,
        position: await production.nextHandoverPosition(tx, parsed.projectId),
      },
    ]);
    if (!item) throw new Error("Point de passation non créé.");
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "handover_item.created",
      entityType: "handover_item",
      entityId: item.id,
      metadata: { label: item.label, projectId: parsed.projectId },
    });
    return item;
  });
}

/** Coche ou décoche un point de passation. Répéter ne fait rien. */
export async function toggleHandoverItem(
  ctx: ServiceContext,
  input: { itemId: string; done: boolean },
): Promise<HandoverChecklistItem> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(toggleHandoverItemSchema, input);
  const item = await production.findHandoverItem(ctx.db, parsed.itemId);
  if (!item) throw new NotFoundError("Point de passation introuvable.");
  await requireEditableProject(ctx, item.projectId);
  return ctx.db.transaction(async (tx) => {
    // Le verrou du projet ordonne ce geste avec la clôture, qui compte les points ouverts.
    await lockEditableProject(tx, item.projectId);
    const fresh = await production.findHandoverItem(tx, item.id);
    if (!fresh) throw new NotFoundError("Point de passation introuvable.");
    if (Boolean(fresh.doneAt) === parsed.done) return fresh;
    const updated = await production.updateHandoverItem(tx, item.id, {
      doneAt: parsed.done ? new Date() : null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: parsed.done ? "handover_item.done" : "handover_item.reopened",
      entityType: "handover_item",
      entityId: item.id,
      metadata: { label: item.label, projectId: item.projectId },
    });
    return updated;
  });
}

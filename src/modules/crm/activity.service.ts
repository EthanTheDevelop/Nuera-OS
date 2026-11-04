import { randomUUID } from "node:crypto";
import type { CrmActivityTarget } from "@/integrations/twenty/crm-gateway";
import { recordAudit } from "@/modules/audit/audit.service";
import { getMembersByIds } from "@/modules/team/team.lookup";
import { assertCan, can } from "@/server/auth/permissions";
import { requireCrm, type ServiceContext } from "@/server/context";
import type { Activity } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { paginated, type PageParams, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import * as repository from "./activity.repository";
import { getCompanyRef, getContactRef } from "./company.lookup";
import { createActivitySchema, updateActivitySchema } from "./crm.schema";
import { assertCrmWritable, dayToInstant } from "./crm.shared";

/**
 * Interactions du CRM. Notes et tâches vivent dans Twenty, appels, réunions et e-mails restent
 * locaux (`twenty_id` NULL) : ces derniers fonctionnent même si Twenty est coupé.
 */
function isTwentyKind(kind: Activity["kind"]): kind is "note" | "task" {
  return kind === "note" || kind === "task";
}

async function resolveLinks(
  ctx: ServiceContext,
  input: {
    companyId?: string | null;
    contactId?: string | null;
    opportunityId?: string | null;
  },
) {
  const [company, contact, opportunity] = await Promise.all([
    input.companyId ? getCompanyRef(ctx.db, input.companyId) : null,
    input.contactId ? getContactRef(ctx.db, input.contactId) : null,
    input.opportunityId ? repository.findOpportunityLink(ctx.db, input.opportunityId) : null,
  ]);
  if (input.companyId && (!company || company.mergedIntoId)) {
    throw new NotFoundError("Client introuvable.");
  }
  if (input.contactId && !contact) throw new NotFoundError("Contact introuvable.");
  if (input.opportunityId && !opportunity) throw new NotFoundError("Affaire introuvable.");
  if (contact?.archivedAt) throw new ConflictError("Ce contact est archivé.");
  if (opportunity?.archivedAt) throw new ConflictError("Cette affaire est archivée.");

  // Refus ici, avant Twenty : les clés composites n'accepteraient pas la ligne, la note serait déjà partie.
  const companyId = company?.id ?? opportunity?.companyId ?? contact?.companyId ?? null;
  if (contact && contact.companyId !== companyId) {
    const message = contact.companyId
      ? "Ce contact appartient à un autre client."
      : "Ce contact n'est rattaché à aucun client.";
    throw new ConflictError(message, { contactId: [message] });
  }
  if (opportunity && opportunity.companyId !== companyId) {
    const message = opportunity.companyId
      ? "Cette affaire appartient à un autre client."
      : "Cette affaire n'est rattachée à aucun client.";
    throw new ConflictError(message, { opportunityId: [message] });
  }
  const resolvedCompany = company ?? (companyId ? await getCompanyRef(ctx.db, companyId) : null);
  if (resolvedCompany?.archivedAt) throw new ConflictError("Ce client est archivé.");

  const targets: CrmActivityTarget[] = [
    ...(resolvedCompany ? [{ type: "company" as const, id: resolvedCompany.twentyId }] : []),
    ...(contact ? [{ type: "person" as const, id: contact.twentyId }] : []),
    ...(opportunity ? [{ type: "opportunity" as const, id: opportunity.twentyId }] : []),
  ];
  return {
    companyId,
    contactId: contact?.id ?? null,
    opportunityId: opportunity?.id ?? null,
    targets,
  };
}

async function assertOwner(ctx: ServiceContext, ownerMemberId: string | null | undefined) {
  if (!ownerMemberId) return;
  const [owner] = await getMembersByIds(ctx.db, [ownerMemberId]);
  if (!owner) {
    throw new ValidationError("Responsable inconnu.", { ownerMemberId: ["Responsable inconnu."] });
  }
}

/** Consigne un échange, une note ou une tâche. L'identifiant de l'appelant rend l'envoi rejouable. */
export async function createActivity(ctx: ServiceContext, input: unknown): Promise<Activity> {
  assertCan(ctx.actor, "crm:update");
  const data = parseInput(createActivitySchema, input);
  const id = data.id ?? randomUUID();

  const existing = await repository.findActivityById(ctx.db, id);
  if (existing) return existing;

  await assertOwner(ctx, data.ownerMemberId);
  const links = await resolveLinks(ctx, data);
  const now = new Date();
  const dueAt = data.kind === "task" && data.dueOn ? dayToInstant(data.dueOn) : null;
  const occurredAt = data.occurredOn ? dayToInstant(data.occurredOn) : now;

  let twentyId: string | null = null;
  if (isTwentyKind(data.kind)) {
    for (const target of links.targets) assertCrmWritable(target.id);
    const crm = requireCrm(ctx);
    if (data.kind === "note") {
      const note = await crm.createNote({
        id,
        title: data.subject,
        bodyMarkdown: data.body ?? null,
        targets: links.targets,
      });
      twentyId = note.id;
    } else {
      const task = await crm.createTask({
        id,
        title: data.subject,
        bodyMarkdown: data.body ?? null,
        dueAt: dueAt?.toISOString() ?? null,
        targets: links.targets,
      });
      twentyId = task.id;
    }
  }

  return ctx.db.transaction(async (tx) => {
    const row = await repository.insertActivity(tx, {
      id,
      twentyId,
      kind: data.kind,
      companyId: links.companyId,
      contactId: links.contactId,
      opportunityId: links.opportunityId,
      subject: data.subject,
      body: data.body ?? null,
      dueAt,
      ownerMemberId: data.ownerMemberId ?? null,
      occurredAt,
    });
    if (!row) {
      // Le webhook de cette création est passé avant : on complète ce que seul Nuera connaît.
      const projected = twentyId ? await repository.findActivityByTwentyId(tx, twentyId) : null;
      if (!projected) throw new Error("Activité introuvable après un conflit d'insertion");
      return repository.updateActivityRow(tx, projected.id, {
        ownerMemberId: data.ownerMemberId ?? null,
        companyId: links.companyId,
        contactId: links.contactId,
        opportunityId: links.opportunityId,
      });
    }
    if (row.opportunityId) {
      await repository.touchOpportunityActivity(tx, row.opportunityId, occurredAt);
    }
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "activity.created",
      entityType: "activity",
      entityId: row.id,
      metadata: { kind: row.kind, companyId: row.companyId, opportunityId: row.opportunityId },
    });
    return row;
  });
}

export async function updateActivity(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<Activity> {
  assertCan(ctx.actor, "crm:update");
  const data = parseInput(updateActivitySchema, input);
  const activity = await repository.findActivityById(ctx.db, id);
  if (!activity) throw new NotFoundError("Activité introuvable.");
  await assertOwner(ctx, data.ownerMemberId);

  const dueAt =
    data.dueOn === undefined ? undefined : data.dueOn === null ? null : dayToInstant(data.dueOn);

  if (
    activity.twentyId &&
    (data.subject !== undefined || data.body !== undefined || dueAt !== undefined)
  ) {
    assertCrmWritable(activity.twentyId);
    const crm = requireCrm(ctx);
    if (activity.kind === "note") {
      await crm.updateNote(activity.twentyId, { title: data.subject, bodyMarkdown: data.body });
    } else if (activity.kind === "task") {
      await crm.updateTask(activity.twentyId, {
        title: data.subject,
        bodyMarkdown: data.body,
        dueAt: dueAt === undefined ? undefined : (dueAt?.toISOString() ?? null),
      });
    }
  }

  return ctx.db.transaction(async (tx) => {
    const row = await repository.updateActivityRow(tx, id, {
      subject: data.subject,
      body: data.body,
      ownerMemberId: data.ownerMemberId,
      dueAt: activity.kind === "task" ? dueAt : undefined,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "activity.updated",
      entityType: "activity",
      entityId: id,
      metadata: { kind: activity.kind },
    });
    return row;
  });
}

/** Termine une tâche. Une seconde demande ne change rien et ne journalise rien. */
export async function completeActivity(ctx: ServiceContext, id: string): Promise<Activity> {
  assertCan(ctx.actor, "crm:update");
  const activity = await repository.findActivityById(ctx.db, id);
  if (!activity) throw new NotFoundError("Activité introuvable.");
  if (activity.kind !== "task") throw new ConflictError("Seule une tâche se termine.");
  if (activity.completedAt) return activity;

  if (activity.twentyId) {
    assertCrmWritable(activity.twentyId);
    await requireCrm(ctx).completeTask(activity.twentyId);
  }
  const now = new Date();
  return ctx.db.transaction(async (tx) => {
    const row = await repository.updateActivityRow(tx, id, { completedAt: now });
    if (row.opportunityId) await repository.touchOpportunityActivity(tx, row.opportunityId, now);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "activity.completed",
      entityType: "activity",
      entityId: id,
      metadata: { companyId: row.companyId, opportunityId: row.opportunityId },
    });
    return row;
  });
}

// --- Lectures ---------------------------------------------------------------------------------

export interface ActivitySummary {
  id: string;
  kind: Activity["kind"];
  subject: string;
  body: string | null;
  occurredAt: Date;
  dueAt: Date | null;
  completedAt: Date | null;
  ownerMemberId: string | null;
  ownerName: string | null;
  companyId: string | null;
  contactId: string | null;
  opportunityId: string | null;
}

function toSummary(row: repository.ActivityWithOwner): ActivitySummary {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    body: row.body,
    occurredAt: row.occurredAt,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    ownerMemberId: row.ownerMemberId,
    ownerName: row.ownerName,
    companyId: row.companyId,
    contactId: row.contactId,
    opportunityId: row.opportunityId,
  };
}

/** Lecture de la fiche 360° : interactions d'un client, de la plus récente à la plus ancienne. */
export async function listActivitiesForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<ActivitySummary[]> {
  assertCan(ctx.actor, "crm:read");
  const rows = await repository.listActivitiesOfCompany(ctx.db, companyId, options);
  return rows.map(toSummary);
}

export async function listActivitiesForOpportunity(
  ctx: ServiceContext,
  opportunityId: string,
  options: { limit?: number } = {},
): Promise<ActivitySummary[]> {
  assertCan(ctx.actor, "sales:read");
  const rows = await repository.listActivitiesOfOpportunity(ctx.db, opportunityId, options);
  return rows.map(toSummary);
}

export async function listActivitiesForContact(
  ctx: ServiceContext,
  contactId: string,
  options: { limit?: number } = {},
): Promise<ActivitySummary[]> {
  assertCan(ctx.actor, "crm:read");
  const rows = await repository.listActivitiesOfContact(ctx.db, contactId, options);
  return rows.map(toSummary);
}

/** Tâches ouvertes d'un client : la prochaine action, sa date, son responsable. */
export async function listOpenTasksForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<ActivitySummary[]> {
  assertCan(ctx.actor, "crm:read");
  const rows = await repository.listOpenTasksOfCompany(ctx.db, companyId, options.limit ?? 20);
  return rows.map(toSummary);
}

export interface TimelineEntry {
  id: string;
  source: "activity" | "stage" | "event" | "appointment";
  kind: string;
  subject: string;
  body: string | null;
  at: Date;
  actorName: string | null;
  fromStage: string | null;
  toStage: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  completedAt: Date | null;
}

/** Événements qui ont leur place dans l'historique d'un client. Une facture exige `finance:read`. */
const TIMELINE_EVENT_TYPES = [
  "quote.sent",
  "quote.accepted",
  "quote.refused",
  "project.created",
  "project.delivered",
  "deliverable.validated",
  "deliverable.changes_requested",
  "site.live",
  "contract.terminated",
  "ticket.created",
  "message.received",
] as const;

export async function listCompanyTimeline(
  ctx: ServiceContext,
  companyId: string,
  params: PageParams,
): Promise<Paginated<TimelineEntry>> {
  assertCan(ctx.actor, "crm:read");
  const eventTypes = can(ctx.actor, "finance:read")
    ? [...TIMELINE_EVENT_TYPES, "invoice.paid"]
    : TIMELINE_EVENT_TYPES;
  const { items, total } = await repository.listCompanyTimelinePage(
    ctx.db,
    companyId,
    params,
    eventTypes,
  );
  return paginated(
    items.map((row) => ({
      id: row.id,
      source: row.source,
      kind: row.kind,
      subject: row.subject,
      body: row.body,
      at: row.at,
      actorName: row.owner_name,
      fromStage: row.from_stage,
      toStage: row.to_stage,
      opportunityId: row.opportunity_id,
      opportunityName: row.opportunity_name,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
    })),
    total,
    params,
  );
}

import { domainEvents } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/**
 * Événements de domaine (`docs/domain-model.md` §6), écrits dans `domain_events`, la boîte d'envoi
 * transactionnelle : un événement n'existe que si l'opération qui l'émet est validée. Les
 * automatisations le lisent ensuite (`dispatched_at` NULL) et n'agissent qu'une fois par règle
 * (`automation_runs`). Une charge utile ne contient que des identifiants, libellés et montants :
 * jamais de secret ni de donnée personnelle superflue.
 */
export const DOMAIN_EVENT_ENTITY_TYPES = {
  "opportunity.created": "opportunity",
  "opportunity.stage_changed": "opportunity",
  "opportunity.won": "opportunity",
  "opportunity.lost": "opportunity",
  "quote.sent": "quote",
  "quote.accepted": "quote",
  "quote.refused": "quote",
  "quote.expired": "quote",
  "project.created": "project",
  "project.status_changed": "project",
  "project.delivered": "project",
  "project.budget_raised": "project",
  "task.overdue": "task",
  "deliverable.submitted": "deliverable",
  "deliverable.validated": "deliverable",
  "deliverable.changes_requested": "deliverable",
  "site.live": "site",
  "site.down": "site",
  "site.up": "site",
  "deployment.finished": "deployment",
  "backup.failed": "site_backup",
  "domain.expiring": "domain",
  "contract.expiring": "contract",
  "contract.quota_80": "contract",
  "contract.quota_exceeded": "contract",
  "contract.terminated": "contract",
  "ticket.created": "ticket",
  "ticket.critical": "ticket",
  "ticket.closed": "ticket",
  "budget.threshold_80": "project",
  "invoice.overdue": "financial_document",
  "invoice.paid": "financial_document",
  "message.received": "message",
} as const;

export type DomainEventType = keyof typeof DOMAIN_EVENT_ENTITY_TYPES;

export const DOMAIN_EVENT_TYPES = Object.keys(DOMAIN_EVENT_ENTITY_TYPES) as DomainEventType[];

/** Charge utile de chaque événement. Dates en ISO, montants en centimes, durées en minutes. */
export interface DomainEventPayloads {
  "opportunity.created": { name: string; stage: string; amountCents: number | null };
  "opportunity.stage_changed": { fromStage: string; toStage: string };
  "opportunity.won": { amountCents: number | null };
  "opportunity.lost": { lostReason: string };
  "quote.sent": { number: string; versionId: string; totalCents: number };
  "quote.accepted": {
    number: string;
    versionId: string;
    opportunityId: string | null;
    totalCents: number;
  };
  "quote.refused": { number: string };
  "quote.expired": { number: string };
  "project.created": { number: string; name: string; quoteId: string | null };
  "project.status_changed": { fromStatus: string; toStatus: string };
  "project.delivered": { number: string; deliveredOn: string };
  "project.budget_raised": { quoteId: string; amountCents: number; minutes: number };
  "task.overdue": {
    projectId: string;
    title: string;
    dueOn: string;
    assigneeMemberId: string | null;
  };
  "deliverable.submitted": { projectId: string; title: string; version: number };
  "deliverable.validated": { projectId: string; title: string; version: number };
  "deliverable.changes_requested": { projectId: string; title: string; version: number };
  "site.live": { name: string; primaryDomain: string | null };
  "site.down": { name: string; primaryDomain: string | null; source: string };
  "site.up": { name: string; primaryDomain: string | null; source: string };
  "deployment.finished": {
    siteId: string;
    environmentId: string;
    status: string;
    source: string;
  };
  "backup.failed": { siteId: string; environmentId: string | null; takenAt: string | null };
  "domain.expiring": { name: string; siteId: string | null; expiresOn: string };
  "contract.expiring": { number: string; renewsOn: string | null; endOn: string | null };
  "contract.quota_80": {
    number: string;
    consumedMinutes: number;
    includedMinutes: number;
    periodStart: string;
  };
  "contract.quota_exceeded": {
    number: string;
    consumedMinutes: number;
    includedMinutes: number;
    periodStart: string;
  };
  "contract.terminated": { number: string; terminatedAt: string; note: string | null };
  "ticket.created": {
    number: string;
    subject: string;
    severity: string;
    channel: string;
    siteId: string | null;
  };
  "ticket.critical": { number: string; subject: string; siteId: string | null };
  "ticket.closed": { number: string; subject: string };
  "budget.threshold_80": { consumedCents: number; budgetCents: number };
  "invoice.overdue": { externalRef: string | null; amountCents: number; dueOn: string | null };
  "invoice.paid": { externalRef: string | null; amountCents: number; paidOn: string | null };
  "message.received": { conversationId: string; direction: string };
}

export interface EmitEventInput<TType extends DomainEventType> {
  type: TType;
  entityType: (typeof DOMAIN_EVENT_ENTITY_TYPES)[TType];
  entityId: string;
  /** NULL si l'événement ne concerne aucun client. */
  companyId: string | null;
  payload: DomainEventPayloads[TType];
  /** NULL pour une action système (tâche planifiée, webhook). */
  actorId: string | null;
  /** Une seconde émission avec la même clé est ignorée. */
  dedupeKey?: string;
  occurredAt?: Date;
}

/** À appeler avec la transaction de l'opération : annulée, elle n'émet rien. */
/** Vrai si l'événement est nouveau, faux si sa clé `dedupeKey` existait déjà. */
export async function emitEvent<TType extends DomainEventType>(
  tx: Database,
  input: EmitEventInput<TType>,
): Promise<boolean> {
  const inserted = await tx
    .insert(domainEvents)
    .values({
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      companyId: input.companyId,
      payload: input.payload as unknown as Record<string, unknown>,
      actorId: input.actorId,
      dedupeKey: input.dedupeKey ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing({ target: domainEvents.dedupeKey })
    .returning({ id: domainEvents.id });
  return inserted.length > 0;
}

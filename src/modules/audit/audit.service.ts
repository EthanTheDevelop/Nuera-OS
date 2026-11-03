import type { Database } from "@/server/db/types";
import { redact } from "@/server/security/redact";
import type { AuditAction, AuditEntityType } from "./audit.constants";
import * as auditRepository from "./audit.repository";

export interface AuditEvent {
  /** NULL pour une action système (CLI, tâche planifiée). */
  actorId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string;
  /** Contexte métier minimal (identifiants, libellés). Jamais de secret. */
  metadata?: Record<string, unknown>;
}

/**
 * Enregistre une opération dans le journal d'audit.
 * À appeler avec la transaction (`tx`) de l'opération tracée : une opération
 * validée est toujours journalisée, une opération annulée ne l'est jamais.
 */
export async function recordAudit(db: Database, event: AuditEvent): Promise<void> {
  await auditRepository.insertAuditEntry(db, {
    actorId: event.actorId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    metadata: redact(event.metadata ?? {}) as Record<string, unknown>,
  });
}

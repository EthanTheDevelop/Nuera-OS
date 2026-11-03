import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./_columns";
import { users } from "./auth";

/**
 * Journal d'audit des opérations importantes (traçabilité).
 *
 * - Écriture uniquement (aucune mise à jour/suppression dans le code applicatif).
 * - Écrit dans la MÊME transaction que l'opération métier tracée.
 * - `metadata` : jamais de secret ni de donnée personnelle superflue
 *   (identifiants et libellés métier uniquement ; masquage automatique en filet).
 * - Durée de conservation et purge : à définir avec le RSSI / DPO.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    /** NULL = action système (CLI, tâche planifiée) ou compte supprimé depuis. */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId, t.occurredAt),
    index("audit_log_occurred_at_idx").on(t.occurredAt),
    index("audit_log_actor_id_idx").on(t.actorId),
  ],
);

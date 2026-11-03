import { auditLog } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

export type NewAuditEntry = typeof auditLog.$inferInsert;

export async function insertAuditEntry(db: Database, entry: NewAuditEntry): Promise<void> {
  await db.insert(auditLog).values(entry);
}

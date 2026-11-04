import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ServiceContext } from "@/server/context";
import * as s from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import { createMemberContext } from "../../helpers/factories";
import { FakeCrmGateway } from "../../helpers/fake-crm-gateway";

/** Monde de test du lot CRM et ventes : base PGlite, fausse passerelle, un contexte par rôle. */
export interface World {
  db: Database;
  crm: FakeCrmGateway;
  admin: ServiceContext;
  member: ServiceContext;
  viewer: ServiceContext;
  contractor: ServiceContext;
  close: () => Promise<void>;
}

export async function createWorld(): Promise<World> {
  const { db, close } = await createTestDatabase();
  const crm = new FakeCrmGateway();
  const admin = await createMemberContext(db, "admin");
  const member = await createMemberContext(db, "member");
  const viewer = await createTestContext(db, "viewer", { crm });
  const contractor = await createMemberContext(db, "contractor");
  return {
    db,
    crm,
    admin: { ...admin, crm },
    member: { ...member, crm },
    viewer,
    contractor: { ...contractor, crm },
    close,
  };
}

export async function auditCount(db: Database, action: string, entityId?: string): Promise<number> {
  const rows = await db
    .select({ id: s.auditLog.id })
    .from(s.auditLog)
    .where(
      and(eq(s.auditLog.action, action), entityId ? eq(s.auditLog.entityId, entityId) : undefined),
    );
  return rows.length;
}

export async function eventCount(db: Database, type: string, entityId: string): Promise<number> {
  const rows = await db
    .select({ id: s.domainEvents.id })
    .from(s.domainEvents)
    .where(and(eq(s.domainEvents.type, type), eq(s.domainEvents.entityId, entityId)));
  return rows.length;
}

export const uuid = () => randomUUID();

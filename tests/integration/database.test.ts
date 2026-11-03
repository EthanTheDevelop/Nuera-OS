import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAudit } from "@/modules/audit/audit.service";
import { isUniqueViolation } from "@/server/db/errors";
import { auditLog, users } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestActor, createTestDatabase } from "../helpers/db";

let db: Database;
let client: PGlite;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
});
afterAll(async () => close());

describe("migrations", () => {
  it("créent le schéma attendu", async () => {
    const result = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "accounts",
      "audit_log",
      "sessions",
      "users",
      "verifications",
    ]);
  });

  it("refusent un rôle inconnu (contrainte CHECK)", async () => {
    await expect(
      client.query(
        "insert into users (name, email, role) values ('X', 'x@test.local', 'superadmin')",
      ),
    ).rejects.toThrow(/users_role_check/);
  });
});

describe("isUniqueViolation", () => {
  it("reconnaît une violation d'unicité remontée par Drizzle", async () => {
    await db.insert(users).values({ name: "A", email: "dup@test.local" });
    const error = await db
      .insert(users)
      .values({ name: "B", email: "dup@test.local" })
      .catch((caught: unknown) => caught);
    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(error, "users_email_unique")).toBe(true);
    expect(isUniqueViolation(error, "autre_contrainte")).toBe(false);
  });
});

describe("recordAudit", () => {
  it("journalise en masquant les données sensibles", async () => {
    const actor = await createTestActor(db, "admin");
    await recordAudit(db, {
      actorId: actor.userId,
      action: "user.created",
      entityType: "user",
      entityId: actor.userId,
      metadata: { role: "member", password: "ne-doit-pas-apparaitre" },
    });
    const [entry] = await db.select().from(auditLog);
    expect(entry?.action).toBe("user.created");
    expect(entry?.metadata).toEqual({ role: "member", password: "[REDACTED]" });
  });

  it("n'écrit rien si la transaction de l'opération est annulée", async () => {
    const before = (await db.select().from(auditLog)).length;
    await db
      .transaction(async (tx) => {
        await recordAudit(tx, { actorId: null, action: "user.created", entityType: "user" });
        throw new Error("échec de l'opération");
      })
      .catch(() => undefined);
    expect((await db.select().from(auditLog)).length).toBe(before);
  });
});

import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  DOMAIN_EVENT_ENTITY_TYPES,
  DOMAIN_EVENT_TYPES,
  emitEvent,
} from "@/modules/platform/events";
import { enqueueEmail } from "@/modules/platform/email-outbox";
import {
  formatSequenceNumber,
  nextNumber,
  nextSequenceValue,
  sequenceYear,
} from "@/modules/platform/sequences";
import * as schema from "@/server/db/schema";
import { domainEvents, emailOutbox, sequences } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestDatabase } from "../helpers/db";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

describe("numéros", () => {
  it("formate au contrat : D-2026-014", () => {
    expect(formatSequenceNumber("quote", 2026, 14)).toBe("D-2026-014");
    expect(formatSequenceNumber("project", 2026, 7)).toBe("P-2026-007");
    expect(formatSequenceNumber("ticket", 2026, 31)).toBe("T-2026-031");
    expect(formatSequenceNumber("contract", 2027, 1000)).toBe("C-2027-1000");
  });

  it("compte à partir de 1, par préfixe et par année", async () => {
    const now = new Date("2030-06-15T12:00:00Z");
    expect(await nextNumber(db, "quote", now)).toBe("D-2030-001");
    expect(await nextNumber(db, "quote", now)).toBe("D-2030-002");
    expect(await nextNumber(db, "project", now)).toBe("P-2030-001");
    expect(await nextNumber(db, "quote", new Date("2031-06-15T12:00:00Z"))).toBe("D-2031-001");
  });

  it("change d'année à minuit, heure de Paris", () => {
    expect(sequenceYear(new Date("2029-12-31T22:30:00Z"))).toBe(2029);
    expect(sequenceYear(new Date("2029-12-31T23:30:00Z"))).toBe(2030);
  });

  it("ne produit aucun doublon sur des créations simultanées", async () => {
    const values = await Promise.all(
      Array.from({ length: 50 }, () =>
        db.transaction((tx) => nextSequenceValue(tx, "ticket", 2032)),
      ),
    );
    expect(new Set(values).size).toBe(50);
    expect(Math.max(...values)).toBe(50);
  });

  it("rend le numéro d'une transaction annulée", async () => {
    await nextSequenceValue(db, "contract", 2033);
    await db
      .transaction(async (tx) => {
        await nextSequenceValue(tx, "contract", 2033);
        throw new Error("annulation");
      })
      .catch(() => undefined);
    expect(await nextSequenceValue(db, "contract", 2033)).toBe(2);
  });
});

/**
 * PGlite n'a qu'une connexion : seul un vrai PostgreSQL éprouve le verrou entre transactions.
 * Lancé à la demande : `TEST_DATABASE_URL=postgres://… npm test -- platform`.
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)("numéros sur PostgreSQL réel", () => {
  it("sérialise 40 transactions concurrentes, sans doublon ni trou", async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 10 });
    const real = drizzle(pool, { schema }) as unknown as Database;
    const year = 9000 + Math.floor(Math.random() * 900);
    try {
      const values = await Promise.all(
        Array.from({ length: 40 }, () =>
          real.transaction(async (tx) => {
            const value = await nextSequenceValue(tx, "ticket", year);
            // Tient le verrou le temps qu'une autre transaction arrive.
            await new Promise((resolve) => setTimeout(resolve, 5));
            return value;
          }),
        ),
      );
      expect([...values].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 40 }, (_, index) => index + 1),
      );
    } finally {
      await real
        .delete(sequences)
        .where(and(eq(sequences.scope, "ticket"), eq(sequences.year, year)));
      await pool.end();
    }
  });
});

describe("événements", () => {
  it("couvre le catalogue du contrat", () => {
    expect(DOMAIN_EVENT_TYPES).toHaveLength(40);
    for (const type of [
      "opportunity.created",
      "opportunity.stage_changed",
      "opportunity.won",
      "opportunity.lost",
      "quote.sent",
      "quote.accepted",
      "quote.refused",
      "quote.expired",
      "project.created",
      "project.status_changed",
      "project.delivered",
      "task.overdue",
      "deliverable.submitted",
      "deliverable.validated",
      "deliverable.changes_requested",
      "site.live",
      "site.down",
      "site.up",
      "deployment.finished",
      "backup.failed",
      "domain.expiring",
      "contract.expiring",
      "contract.quota_80",
      "contract.quota_exceeded",
      "contract.terminated",
      "ticket.created",
      "ticket.critical",
      "ticket.closed",
      "budget.threshold_80",
      "invoice.overdue",
      "invoice.paid",
      "message.received",
    ] as const) {
      expect(DOMAIN_EVENT_ENTITY_TYPES[type]).toBeTruthy();
    }
  });

  const input = {
    type: "quote.refused",
    entityType: "quote",
    entityId: crypto.randomUUID(),
    companyId: null,
    payload: { number: "D-2026-001" },
    actorId: null,
  } as const;

  it("écrit l'événement, en attente d'envoi", async () => {
    await emitEvent(db, input);
    const [row] = await db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.entityId, input.entityId));
    expect(row).toMatchObject({
      type: "quote.refused",
      entityType: "quote",
      payload: { number: "D-2026-001" },
      dispatchedAt: null,
      dedupeKey: null,
    });
  });

  it("ignore une seconde émission avec la même clé", async () => {
    const entityId = crypto.randomUUID();
    const dedupeKey = `test:${entityId}`;
    await emitEvent(db, { ...input, entityId, dedupeKey });
    await emitEvent(db, { ...input, entityId, dedupeKey });
    const rows = await db.select().from(domainEvents).where(eq(domainEvents.entityId, entityId));
    expect(rows).toHaveLength(1);
  });

  it("n'écrit rien si la transaction est annulée", async () => {
    const entityId = crypto.randomUUID();
    await db
      .transaction(async (tx) => {
        await emitEvent(tx, { ...input, entityId });
        throw new Error("annulation");
      })
      .catch(() => undefined);
    const rows = await db.select().from(domainEvents).where(eq(domainEvents.entityId, entityId));
    expect(rows).toHaveLength(0);
  });
});

describe("boîte d'envoi", () => {
  it("dépose l'e-mail en attente, sans doublon par clé", async () => {
    const message = { to: "a@test.local", subject: "Objet", text: "Corps", dedupeKey: "once" };
    await enqueueEmail(db, message);
    await enqueueEmail(db, message);
    const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.dedupeKey, "once"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ toAddress: "a@test.local", status: "pending", attempts: 0 });
  });
});

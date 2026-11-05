import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDashboard } from "@/modules/dashboard/dashboard.service";
import { getReporting } from "@/modules/dashboard/reporting.service";
import { nextNumber } from "@/modules/platform/sequences";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { applyStagingPlan, currentDatabaseName } from "../../scripts/lib/staging-seed/apply";
import {
  generateStagingPlan,
  planCounts,
  STAGING_TAG,
  STAGING_TWENTY_PREFIX,
  stagingSiren,
} from "../../scripts/lib/staging-seed/generate";
import {
  connectedDatabaseRefusalReason,
  databaseNameFromUrl,
  stagingSeedRefusalReason,
} from "../../scripts/lib/staging-seed/guard";
import { createTestContext, createTestDatabase } from "../helpers/db";

const referenceDate = new Date("2026-11-05T12:00:00Z");
const staging = "postgres://nuera:secret@db.internal:5432/nuera_os_staging";

describe("garde-fous du jeu staging", () => {
  it("exige SEED_ALLOWED=true, à la lettre", () => {
    expect(stagingSeedRefusalReason({ databaseUrl: staging, seedAllowed: "true" })).toBeNull();
    for (const value of [undefined, "", "1", "yes", "TRUE", "true ", "false"]) {
      expect(stagingSeedRefusalReason({ databaseUrl: staging, seedAllowed: value })).toMatch(
        /SEED_ALLOWED/,
      );
    }
  });

  it("refuse toute base autre que nuera_os_staging, production comprise", () => {
    const refused = [
      "postgres://nuera:secret@db.internal:5432/nuera_os",
      "postgres://nuera:secret@db.internal:5432/nuera_os_staging_old",
      "postgres://nuera:secret@db.internal:5432/NUERA_OS_STAGING",
      "postgres://nuera:secret@db.internal:5432/",
      "postgres://nuera:secret@db.internal:5432",
      "postgres://nuera:secret@db.internal:5432/nuera_os_staging/x",
      "postgres://nuera:secret@db.internal:5432/nuera_os_staging?dbname=nuera_os",
      "postgres://nuera:secret@db.internal:5432/nuera_os_staging?options=-c%20search_path%3Dx",
      "mysql://nuera:secret@db.internal:3306/nuera_os_staging",
      "pas une url",
      undefined,
    ];
    for (const databaseUrl of refused) {
      expect(stagingSeedRefusalReason({ databaseUrl, seedAllowed: "true" })).not.toBeNull();
    }
    expect(databaseNameFromUrl("postgresql://u@h/nuera%5Fos%5Fstaging")).toBe("nuera_os_staging");
  });

  it("vérifie aussi le nom de la base une fois connecté", () => {
    expect(connectedDatabaseRefusalReason("nuera_os_staging")).toBeNull();
    expect(connectedDatabaseRefusalReason("nuera_os")).toMatch(/nuera_os/);
    expect(connectedDatabaseRefusalReason(null)).not.toBeNull();
  });
});

describe("génération", () => {
  it("est reproductible pour une même graine", () => {
    const first = generateStagingPlan({ seed: 7, companies: 12, referenceDate });
    const second = generateStagingPlan({ seed: 7, companies: 12, referenceDate });
    expect(second).toEqual(first);
    const other = generateStagingPlan({ seed: 8, companies: 12, referenceDate });
    expect(other.companies.map((row) => row.id)).not.toEqual(first.companies.map((row) => row.id));
  });

  it("ajoute des dossiers sans changer les premiers quand le volume augmente", () => {
    const small = generateStagingPlan({ seed: 7, companies: 10, referenceDate });
    const large = generateStagingPlan({ seed: 7, companies: 30, referenceDate });
    expect(large.companies.slice(0, 10)).toEqual(small.companies);
    expect(large.tasks.slice(0, small.tasks.length)).toEqual(small.tasks);
  });

  it("produit des fiches sans moyen de joindre une vraie personne", () => {
    const plan = generateStagingPlan({ seed: 7, companies: 40, referenceDate });
    for (const company of plan.companies) {
      expect(company.twentyId.startsWith(STAGING_TWENTY_PREFIX)).toBe(true);
      expect(company.domain).toMatch(/\.example$/);
      expect(company.tags).toContain(STAGING_TAG);
      expect(company.phone).toMatch(/^\+3319900\d{4}$/);
    }
    for (const contact of plan.contacts) {
      expect(contact.email).toMatch(/@[a-z0-9-]+\.example$/);
      expect(contact.phone).toMatch(/^\+33639980\d{3}$/);
    }
    expect(new Set(plan.companies.map((row) => row.siren)).size).toBe(plan.companies.length);
    expect(stagingSiren(7, 0)).toMatch(/^8\d{8}$/);
  });

  it("garde des dates cohérentes avec la date de référence", () => {
    const plan = generateStagingPlan({ seed: 11, companies: 60, referenceDate });
    const today = "2026-11-05";
    for (const row of plan.timeEntries) expect(row.workOn < today).toBe(true);
    for (const row of plan.financialDocuments) {
      expect(row.issuedOn && row.issuedOn < today).toBe(true);
      if (row.paidOn) expect(row.paidOn < today).toBe(true);
      if (row.status === "overdue") expect(row.dueOn && row.dueOn < today).toBe(true);
    }
    for (const row of plan.appointments) {
      if (row.status === "done")
        expect(row.startsAt.getTime()).toBeLessThan(referenceDate.getTime());
      if (row.status === "planned")
        expect(row.startsAt.getTime()).toBeGreaterThan(referenceDate.getTime());
    }
    for (const row of plan.tasks) if (row.status === "done") expect(row.completedAt).toBeTruthy();
  });

  it("refuse un volume hors bornes", () => {
    expect(() => generateStagingPlan({ seed: 1, companies: 0, referenceDate })).toThrow();
    expect(() => generateStagingPlan({ seed: 1, companies: 1001, referenceDate })).toThrow();
    expect(() => generateStagingPlan({ seed: -1, companies: 5, referenceDate })).toThrow();
  });
});

describe("insertion", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  it("insère tout le plan en respectant les clés étrangères", async () => {
    const ctx = await createTestContext(db, "admin");
    const [userBefore] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, ctx.actor.userId));
    const usersBefore = await db.$count(schema.users);

    const plan = generateStagingPlan({ seed: 3, companies: 25, referenceDate });
    const result = await applyStagingPlan(db, plan, { referenceDate, metadata: { seed: 3 } });
    expect(result.inserted).toEqual(planCounts(plan));
    expect(Object.values(result.inserted).reduce((a, b) => a + b, 0)).toBeGreaterThan(500);

    // Les comptes existants ne sont ni créés, ni modifiés, ni supprimés.
    expect(await db.$count(schema.users)).toBe(usersBefore);
    const [userAfter] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, ctx.actor.userId));
    expect(userAfter).toEqual(userBefore);

    // Chaque devis pointe sur sa version courante ; une échéance facturée, sur sa facture.
    const quotes = await db.select().from(schema.quotes);
    expect(quotes.every((quote) => quote.currentVersionId)).toBe(true);
    expect(
      quotes.filter((quote) => quote.status === "accepted").every((q) => q.acceptedVersionId),
    ).toBe(true);
    const invoiced = await db.select().from(schema.paymentScheduleItems);
    expect(
      invoiced.filter((row) => row.status !== "planned").every((row) => row.financialDocumentId),
    ).toBe(true);

    // Le compteur a avancé : le prochain devis créé à la main ne heurte aucun numéro.
    const next = await nextNumber(db, "quote", referenceDate);
    expect(quotes.map((quote) => quote.number)).not.toContain(next);
  });

  it("n'ajoute rien quand on relance la même graine, et ne réécrit rien", async () => {
    const [company] = await db
      .select()
      .from(schema.companies)
      .where(like(schema.companies.twentyId, `${STAGING_TWENTY_PREFIX}%`))
      .limit(1);
    if (!company) throw new Error("Aucune entreprise du jeu staging.");
    await db
      .update(schema.companies)
      .set({ notes: "Modifié à la main" })
      .where(eq(schema.companies.id, company.id));

    const plan = generateStagingPlan({ seed: 3, companies: 25, referenceDate });
    const result = await applyStagingPlan(db, plan, { referenceDate, metadata: {} });
    expect(Object.values(result.inserted).every((count) => count === 0)).toBe(true);
    const [after] = await db
      .select({ notes: schema.companies.notes })
      .from(schema.companies)
      .where(eq(schema.companies.id, company.id));
    expect(after?.notes).toBe("Modifié à la main");
  });

  it("complète seulement les nouveaux dossiers quand le volume augmente", async () => {
    const before = await db.$count(schema.companies);
    const plan = generateStagingPlan({ seed: 3, companies: 30, referenceDate });
    const result = await applyStagingPlan(db, plan, { referenceDate, metadata: {} });
    expect(result.inserted.companies).toBe(5);
    expect(result.inserted.teamMembers).toBe(0);
    expect(await db.$count(schema.companies)).toBe(before + 5);
  });

  it("n'écrit rien en essai à blanc", async () => {
    const before = await db.$count(schema.companies);
    const audits = await db.$count(schema.auditLog);
    const plan = generateStagingPlan({ seed: 99, companies: 5, referenceDate });
    const result = await applyStagingPlan(db, plan, {
      referenceDate,
      dryRun: true,
      metadata: {},
    });
    expect(result.dryRun).toBe(true);
    expect(result.inserted.companies).toBe(5);
    expect(await db.$count(schema.companies)).toBe(before);
    expect(await db.$count(schema.auditLog)).toBe(audits);
  });

  it("se lit sans erreur dans le tableau de bord et le reporting", async () => {
    const ctx = await createTestContext(db, "admin");
    const dashboard = await getDashboard(ctx, { editing: true, now: referenceDate });
    const failed = Object.entries(dashboard.tiles).filter(([, tile]) => tile?.status === "error");
    expect(failed).toEqual([]);
    await expect(getReporting(ctx, {}, referenceDate)).resolves.toBeTruthy();
  });

  it("lit le nom de la base connectée", async () => {
    expect(await currentDatabaseName(db)).toBe("postgres");
  });
});

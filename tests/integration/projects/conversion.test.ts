import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocusealGateway } from "@/integrations/docuseal";
import { convertChangeRequestToQuote } from "@/modules/projects/change-request.conversion";
import {
  acceptChangeRequest,
  createChangeRequest,
  refuseChangeRequest,
} from "@/modules/projects/production.service";
import { sweepProjectBudgets } from "@/modules/projects/project.service";
import { createAmendment } from "@/modules/quotes/quote.service";
import { createTimeEntry } from "@/modules/time/time.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createMemberContext,
  createProject,
  createQuote,
} from "../../helpers/factories";

/** Aucun envoi de signature dans ces parcours : le service de signature reste non configuré. */
const deps = { docuseal: { isConfigured: false } as unknown as DocusealGateway };

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;

beforeAll(async () => {
  const test = await createTestDatabase();
  db = test.db;
  close = test.close;
  admin = await createMemberContext(db, "admin");
});

afterAll(async () => {
  await close();
});

async function reload(changeRequestId: string) {
  const [row] = await db
    .select()
    .from(schema.changeRequests)
    .where(eq(schema.changeRequests.id, changeRequestId));
  return row;
}

async function linesOf(quoteId: string) {
  const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, quoteId));
  const lines = await db
    .select()
    .from(schema.quoteLines)
    .where(eq(schema.quoteLines.quoteVersionId, quote?.currentVersionId ?? ""));
  return { quote, lines };
}

describe("transformer une demande de changement en devis", () => {
  it("sans devis d'origine : un nouveau devis, avec le chiffrage en première ligne", async () => {
    const project = await createProject(db, { status: "active" });
    const request = await createChangeRequest(admin, {
      projectId: project.id,
      title: "Espace presse",
      amountCents: 90_000,
      estimatedMinutes: 840,
    });

    const { quoteId } = await convertChangeRequestToQuote(
      admin,
      { changeRequestId: request.id },
      deps,
    );

    expect(await reload(request.id)).toMatchObject({ status: "converted", quoteId });
    const { quote, lines } = await linesOf(quoteId);
    expect(quote).toMatchObject({
      companyId: project.companyId,
      title: "Espace presse",
      parentQuoteId: null,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      label: "Espace presse",
      quantity: 1,
      unitPriceCents: 90_000,
      estimatedMinutes: 840,
    });
  });

  it("répéter rouvre le même devis, sans en créer un second", async () => {
    const project = await createProject(db, { status: "active" });
    const request = await createChangeRequest(admin, { projectId: project.id, title: "Blog" });
    const first = await convertChangeRequestToQuote(admin, { changeRequestId: request.id }, deps);
    const again = await convertChangeRequestToQuote(admin, { changeRequestId: request.id }, deps);
    expect(again.quoteId).toBe(first.quoteId);
    const quotes = await db
      .select()
      .from(schema.quotes)
      .where(and(eq(schema.quotes.companyId, project.companyId)));
    expect(quotes).toHaveLength(1);
  });

  it("depuis un projet signé : un avenant du devis d'origine", async () => {
    const company = await createCompany(db);
    const { quote: signed, version } = await createQuote(db, {
      companyId: company.id,
      status: "accepted",
    });
    await db
      .update(schema.quotes)
      .set({ acceptedVersionId: version.id })
      .where(eq(schema.quotes.id, signed.id));
    const project = await createProject(db, {
      companyId: company.id,
      quoteId: signed.id,
      status: "active",
    });
    const request = await createChangeRequest(admin, {
      projectId: project.id,
      title: "Module de réservation",
      amountCents: 40_000,
    });

    const { quoteId } = await convertChangeRequestToQuote(
      admin,
      { changeRequestId: request.id },
      deps,
    );
    const { quote, lines } = await linesOf(quoteId);
    expect(quote?.parentQuoteId).toBe(signed.id);
    expect(lines[0]?.unitPriceCents).toBe(40_000);
  });

  it("des travaux acceptés peuvent encore être chiffrés, une demande refusée non", async () => {
    const project = await createProject(db, { status: "active" });
    const accepted = await createChangeRequest(admin, { projectId: project.id, title: "Galerie" });
    await acceptChangeRequest(admin, { changeRequestId: accepted.id });
    const { quoteId } = await convertChangeRequestToQuote(
      admin,
      { changeRequestId: accepted.id },
      deps,
    );
    expect(await reload(accepted.id)).toMatchObject({ status: "converted", quoteId });

    const refused = await createChangeRequest(admin, { projectId: project.id, title: "Non" });
    await refuseChangeRequest(admin, { changeRequestId: refused.id });
    await expect(
      convertChangeRequestToQuote(admin, { changeRequestId: refused.id }, deps),
    ).rejects.toThrow(ConflictError);
  });

  it("l'avenant du module Devis transforme une demande acceptée", async () => {
    const company = await createCompany(db);
    const { quote: signed, version } = await createQuote(db, {
      companyId: company.id,
      status: "accepted",
    });
    await db
      .update(schema.quotes)
      .set({ acceptedVersionId: version.id })
      .where(eq(schema.quotes.id, signed.id));
    const project = await createProject(db, { companyId: company.id, status: "active" });
    const request = await createChangeRequest(admin, {
      projectId: project.id,
      title: "Multilingue",
      amountCents: 10_000,
    });
    await acceptChangeRequest(admin, { changeRequestId: request.id });

    const amendment = await createAmendment(admin, signed.id, {
      title: "Avenant multilingue",
      changeRequestId: request.id,
    });
    expect(await reload(request.id)).toMatchObject({
      status: "converted",
      quoteId: amendment.id,
    });
  });

  it("réservé à qui peut modifier le projet et créer un devis", async () => {
    const project = await createProject(db, { status: "active" });
    const request = await createChangeRequest(admin, { projectId: project.id, title: "x" });
    for (const role of ["viewer", "contractor"] as const) {
      const ctx = await createTestContext(db, role);
      await expect(
        convertChangeRequestToQuote(ctx, { changeRequestId: request.id }, deps),
      ).rejects.toThrow(ForbiddenError);
    }
    expect((await reload(request.id))?.status).toBe("open");
  });
});

describe("alerte de budget", () => {
  it("la saisie de temps et le rattrapage n'émettent qu'un seul événement par projet", async () => {
    const ctx = await createMemberContext(db, "admin", { hourlyCostCents: 6000 });
    const company = await createCompany(db);
    const project = await createProject(db, {
      companyId: company.id,
      budgetCents: 10_000,
      status: "active",
    });
    await createTimeEntry(ctx, {
      projectId: project.id,
      workOn: "2026-10-01",
      minutes: 90,
      category: "production",
    });
    await sweepProjectBudgets(db);
    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(
        and(
          eq(schema.domainEvents.type, "budget.threshold_80"),
          eq(schema.domainEvents.entityId, project.id),
        ),
      );
    expect(events).toHaveLength(1);
  });
});

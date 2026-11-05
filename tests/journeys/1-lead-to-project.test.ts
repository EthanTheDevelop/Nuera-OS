import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { receiveDocusealWebhook } from "@/integrations/docuseal/docuseal.webhook";
import { createCompany, getCompany } from "@/modules/crm/company.service";
import { createContact } from "@/modules/crm/contact.service";
import { dispatchPendingEvents } from "@/modules/platform/automation.service";
import { getProjectDetail, listProjects } from "@/modules/projects/project.service";
import {
  acceptQuoteManually,
  processDocusealWebhook,
  sendQuoteForSignature,
} from "@/modules/quotes/quote-signature.service";
import { createQuote, getQuoteDetail, saveQuoteContent } from "@/modules/quotes/quote.service";
import {
  createOpportunity,
  getOpportunity,
  getOpportunityStageHistory,
  moveOpportunityStage,
} from "@/modules/sales/opportunity.service";
import * as s from "@/server/db/schema";
import { content, DocusealStub } from "../integration/quotes/helpers";
import { createJourneyWorld, eventsOf, notificationsOf, type JourneyWorld } from "./world";

const SECRET = "whsec_parcours_0123456789abcdef";

/** Le corps tel que DocuSeal l'envoie, signé : le webhook passe par le vrai contrôle. */
function signedCompletion(submissionId: string) {
  const rawBody = JSON.stringify({
    event_type: "submission.completed",
    timestamp: "2026-11-02T10:00:00Z",
    data: { id: Number(submissionId), status: "completed", completed_at: "2026-11-02T10:00:00Z" },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", SECRET).update(`${timestamp}.${rawBody}`).digest("hex");
  return receiveDocusealWebhook({
    rawBody,
    secret: SECRET,
    headers: new Headers({ "x-docuseal-signature": `${timestamp}.${digest}` }),
  });
}

describe("parcours 1 : lead → affaire → devis → accepté et gagné → projet", () => {
  let world: JourneyWorld;
  const stub = new DocusealStub();

  beforeAll(async () => {
    world = await createJourneyWorld();
    await stub.start();
  });
  afterAll(async () => {
    await stub.stop();
    await world.close();
  });

  it("donne un seul projet, vu de chaque côté, même rejoué", async () => {
    const { admin, member, viewer, db, crm } = world;

    // Lead : une société et un contact, créés dans Twenty puis projetés.
    const companyId = randomUUID();
    const company = await createCompany(member, {
      id: companyId,
      name: "Boulangerie Parcours",
      domain: "boulangerie-parcours.example",
      status: "prospect",
    });
    expect(company.status).toBe("prospect");
    // Une création rejouée (double clic, reprise) ne double ni la fiche ni Twenty.
    await createCompany(member, { id: companyId, name: "Boulangerie Parcours" });
    expect(await db.select().from(s.companies).where(eq(s.companies.id, companyId))).toHaveLength(
      1,
    );
    const contact = await createContact(member, {
      companyId,
      firstName: "Inès",
      lastName: "Parcours",
      email: "ines@boulangerie-parcours.example",
    });

    // Affaire.
    const opportunityId = randomUUID();
    const opportunity = await createOpportunity(member, {
      id: opportunityId,
      name: "Site de la boulangerie",
      companyId,
      contactId: contact.id,
      stage: "NEW",
    });
    await createOpportunity(member, { id: opportunityId, name: "Site de la boulangerie" });
    const twentyId = opportunity.twentyId ?? "";
    expect(await crm.getOpportunity(twentyId)).toMatchObject({ stage: "NEW" });
    await moveOpportunityStage(member, { opportunityId, toStage: "QUALIFIED" });

    // Devis, envoyé pour signature : l'affaire avance seule.
    const quote = await createQuote(member, { companyId, opportunityId, title: "Site vitrine" });
    await saveQuoteContent(member, quote.id, content(), stub.deps());
    const sent = await sendQuoteForSignature(
      member,
      quote.id,
      { signerContactId: contact.id },
      stub.deps(),
    );
    expect(sent.status).toBe("sent");
    expect((await getOpportunity(member, opportunityId)).stage).toBe("QUOTE_SENT");
    const submissionId = sent.docusealSubmissionId ?? "";
    expect(submissionId).not.toBe("");

    // Le client signe chez DocuSeal, qui rejoue son webhook.
    const base = { db, crm };
    expect(await processDocusealWebhook(base, signedCompletion(submissionId))).toBe("processed");
    expect(await processDocusealWebhook(base, signedCompletion(submissionId))).toBe("duplicate");

    // Côté devis.
    const detail = await getQuoteDetail(viewer, quote.id);
    expect(detail.quote).toMatchObject({ status: "accepted", signatureStatus: "signed" });
    expect(detail.quote.acceptedVersionId).toBe(detail.version.id);

    // Côté pipeline, et dans Twenty, maître de l'étape.
    const won = await getOpportunity(viewer, opportunityId);
    expect(won.stage).toBe("WON");
    expect(won.amountCents).toBe(780_000);
    expect(await crm.getOpportunity(twentyId)).toMatchObject({ stage: "WON" });
    const history = await getOpportunityStageHistory(viewer, opportunityId);
    expect(history.filter((row) => row.toStage === "WON")).toHaveLength(1);

    // Côté client : le prospect est devenu client.
    expect((await getCompany(viewer, companyId)).company.status).toBe("client");

    // Côté production : un projet, avec le budget et le temps vendus.
    const listed = await listProjects(viewer, { view: "upcoming", search: "Site vitrine" });
    expect(listed.total).toBe(1);
    const projectId = listed.items[0]?.id ?? "";
    const project = await getProjectDetail(admin, projectId);
    expect(project).toMatchObject({
      companyId,
      quote: { id: quote.id },
      budgetCents: 780_000,
      estimatedMinutes: 5040,
    });
    expect(project.phases.length).toBeGreaterThan(0);

    // Une acceptation manuelle après la signature ne refait rien.
    await acceptQuoteManually(
      admin,
      quote.id,
      { signedOn: "2026-11-02", officialDocumentUrl: "https://docuseal.test/document" },
      stub.deps(),
    );

    const projects = await db.select().from(s.projects).where(eq(s.projects.quoteId, quote.id));
    expect(projects).toHaveLength(1);
    expect(await eventsOf(db, "quote.accepted", quote.id)).toHaveLength(1);
    expect(await eventsOf(db, "project.created", projectId)).toHaveLength(1);
    expect(await eventsOf(db, "opportunity.won", opportunityId)).toHaveLength(1);

    // L'équipe est prévenue une seule fois, le répartiteur rejoué compris.
    await dispatchPendingEvents(db);
    await dispatchPendingEvents(db);
    const signed = (await notificationsOf(db, admin.actor.userId)).filter(
      (row) => row.kind === "quote_signed",
    );
    expect(signed).toHaveLength(1);
    expect(signed[0]?.href).toBe(`/devis/${quote.id}`);
  });
});

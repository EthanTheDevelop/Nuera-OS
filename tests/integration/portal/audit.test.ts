import { and, eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  inviteClientToPortal,
  issuePortalInvitationLink,
  loadAgencyPreview,
  resendPortalInvitation,
  revokePortalAccess,
  type PortalAccessDeps,
} from "@/modules/portal/portal-access.service";
import {
  getPortalDocumentsPage,
  loadProjectHome,
  openPortalTicket,
  requestSiteChange,
  submitDeliverableReview,
  submitRequirementText,
} from "@/modules/portal/portal.service";
import { ProjectHome } from "@/modules/portal/components/project-home";
import { buildInvitationEmail } from "@/modules/portal/portal.email";
import { markPortalRead } from "@/modules/messaging/message.service";
import { buildAuth, type Auth } from "@/server/auth/auth";
import { createPortalLinkIssuer } from "@/server/auth/portal-link";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import { createCompany, createContact } from "../../helpers/factories";
import { createClientWorld, type ClientWorld } from "./helpers";

/** Le rendu de `ProjectHome` n'a pas besoin des actions : l'aperçu n'en appelle aucune. */
vi.mock("@/modules/portal/portal.actions", () => ({}));

const BASE = "http://localhost:3000";

let db: Database;
let close: () => Promise<void>;
let auth: Auth;
let admin: ServiceContext;
let member: ServiceContext;
let viewer: ServiceContext;
let deps: PortalAccessDeps;
let a: ClientWorld;
let b: ClientWorld;
let counter = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  auth = buildAuth({ db, secret: "s".repeat(32), baseURL: BASE });
  admin = await createTestContext(db, "admin");
  member = await createTestContext(db, "member");
  viewer = await createTestContext(db, "viewer");
  deps = {
    host: "app.nuera.test",
    issueLink: createPortalLinkIssuer({ db, secret: "s".repeat(32), baseURL: BASE }),
  };
  a = await createClientWorld(db, "Alpha");
  b = await createClientWorld(db, "Beta");
});
afterAll(async () => close());

const inboundOf = (world: ClientWorld) =>
  db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.companyId, world.ctx.companyId),
        eq(schema.messages.direction, "inbound"),
      ),
    );

describe("aperçu de l'agence", () => {
  it("les paiements du client restent réservés à finance:read", async () => {
    expect((await loadAgencyPreview(admin, a.project.id)).payments?.totalCents).toBe(780_000);
    expect((await loadAgencyPreview(member, a.project.id)).payments).toBeNull();
    expect((await loadAgencyPreview(viewer, a.project.id)).payments).toBeNull();
    // Le client, lui, lit toujours les siens.
    expect((await loadProjectHome(a.ctx, a.project.id)).payments?.totalCents).toBe(780_000);
  });

  it("une adresse mal formée répond 404, pas une erreur de base", async () => {
    await expect(loadAgencyPreview(admin, "abc")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("aucune voie d'écriture : ni formulaire, ni bouton, ni lien vers le fil ou l'agenda", async () => {
    const home = await loadAgencyPreview(admin, a.project.id);
    // Une version à valider et un contenu attendu : sans `readOnly`, leurs actions s'afficheraient.
    expect(home.deliverables.some((item) => item.status === "to_validate")).toBe(true);
    expect(home.project.requirements.some((item) => item.status === "expected")).toBe(true);
    const html = renderToStaticMarkup(
      createElement(ProjectHome, { home, greeting: "Bonjour", now: new Date(), readOnly: true }),
    );
    expect(html).toContain(home.deliverables[0]?.title);
    expect(html).not.toMatch(/<form|<button|<input|<textarea/);
    expect(html).not.toMatch(/\/espace\/messages|\/agenda/);
    // Sans fichier stocké dans ce jeu de test, le seul lien possible est l'aperçu d'un document.
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      expect(href).toMatch(/^\/api\/documents\/[0-9a-f-]+\/download/);
    }
  });
});

describe("liens et révocation", () => {
  async function invited() {
    counter += 1;
    const company = await createCompany(db, { status: "client", name: `Société ${counter}` });
    const contact = await createContact(db, {
      companyId: company.id,
      firstName: "Alix",
      lastName: `Nom${counter}`,
      email: `alix.${counter}@client.test`,
    });
    const { membershipId } = await inviteClientToPortal(
      member,
      { companyId: company.id, contactId: contact.id },
      deps,
    );
    return { company, contact, membershipId };
  }

  it("un lien transmis avant la révocation ne revit pas à la réinvitation", async () => {
    const { company, contact, membershipId } = await invited();
    const { url: before } = await issuePortalInvitationLink(admin, { membershipId }, deps);

    await revokePortalAccess(member, { membershipId });
    await inviteClientToPortal(member, { companyId: company.id, contactId: contact.id }, deps);

    const stale = await auth.handler(new Request(before, { redirect: "manual" }));
    expect(stale.headers.get("location")).toContain("/espace/lien-expire");

    const { url: fresh } = await issuePortalInvitationLink(admin, { membershipId }, deps);
    const opened = await auth.handler(new Request(fresh, { redirect: "manual" }));
    expect(opened.headers.get("location")).toBe(`${BASE}/espace`);
  });

  it("la révocation n'efface que les liens de ce compte", async () => {
    const first = await invited();
    const other = await invited();
    const { url } = await issuePortalInvitationLink(
      admin,
      { membershipId: other.membershipId },
      deps,
    );
    await revokePortalAccess(member, { membershipId: first.membershipId });
    const opened = await auth.handler(new Request(url, { redirect: "manual" }));
    expect(opened.headers.get("location")).toBe(`${BASE}/espace`);
  });

  it("si la fiche prend l'adresse d'un autre client, aucun lien ne part vers son compte", async () => {
    const { contact, membershipId } = await invited();
    const victim = await invited();
    await db
      .update(schema.contacts)
      .set({ email: victim.contact.email })
      .where(eq(schema.contacts.id, contact.id));

    await expect(issuePortalInvitationLink(admin, { membershipId }, deps)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(resendPortalInvitation(member, { membershipId }, deps)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("l'e-mail sans interlocuteur ne signe pas deux fois", () => {
    const { text } = buildInvitationEmail({
      firstName: "Alix",
      projectName: null,
      interlocutors: "Nuera Studio",
      url: `${BASE}/lien`,
      host: "app.nuera.test",
    });
    expect(text).not.toContain("Nuera Studio, Nuera Studio");
  });
});

describe("rien ne se perd, rien ne se double", () => {
  it("un contenu envoyé deux fois par écrit ne crée qu'un message", async () => {
    const [requirement] = await db
      .insert(schema.clientRequirements)
      .values({ projectId: a.project.id, label: "Horaires", status: "expected" })
      .returning();
    const requirementId = requirement?.id ?? "";
    const before = (await inboundOf(a)).length;

    await submitRequirementText(a.ctx, { requirementId, text: "Du mardi au samedi" });
    await submitRequirementText(a.ctx, { requirementId, text: "Du mardi au samedi" });
    expect(await inboundOf(a)).toHaveLength(before + 1);

    // Un autre texte, lui, arrive bien.
    await submitRequirementText(a.ctx, { requirementId, text: "Et le dimanche matin" });
    expect(await inboundOf(a)).toHaveLength(before + 2);
  });

  it("un contenu d'un autre client ne laisse aucune trace, même par écrit", async () => {
    const before = (await inboundOf(a)).length;
    await expect(
      submitRequirementText(a.ctx, { requirementId: b.requirement.id, text: "Texte" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await inboundOf(a)).toHaveLength(before);
  });

  it("deux versions du même texte en une minute : la seconde n'est pas perdue", async () => {
    const siteId = a.site.id;
    const first = await requestSiteChange(a.ctx, {
      siteId,
      current: "Horaires du lundi",
      next: "Ouvert le lundi",
    });
    const second = await requestSiteChange(a.ctx, {
      siteId,
      current: "Horaires du lundi",
      next: "Fermé le lundi",
    });
    expect(second.id).toBe(first.id);
    const replies = await db
      .select()
      .from(schema.ticketMessages)
      .where(eq(schema.ticketMessages.ticketId, first.id));
    expect(replies).toHaveLength(1);
    expect(replies[0]?.body).toContain("Fermé le lundi");
    expect(replies[0]?.internal).toBe(false);

    // Répéter exactement le même envoi n'ajoute rien, passé le délai du service ou non.
    await requestSiteChange(a.ctx, {
      siteId,
      current: "Horaires du lundi",
      next: "Fermé le lundi",
    });
    await requestSiteChange(a.ctx, {
      siteId,
      current: "Horaires du lundi",
      next: "Ouvert le lundi",
    });
    expect(
      await db
        .select()
        .from(schema.ticketMessages)
        .where(eq(schema.ticketMessages.ticketId, first.id)),
    ).toHaveLength(1);
  });

  it("une demande sans doublon garde son détail une seule fois", async () => {
    const ticket = await openPortalTicket(a.ctx, {
      subject: "Question unique",
      description: "Le détail",
    });
    const rows = await db
      .select()
      .from(schema.ticketMessages)
      .where(eq(schema.ticketMessages.ticketId, ticket.id));
    expect(rows).toEqual([]);
  });

  it("une validation ne vaut que pour la version que le client a vue", async () => {
    const [deliverable] = await db
      .insert(schema.deliverables)
      .values({
        projectId: a.project.id,
        title: "Maquette versionnée",
        status: "to_validate",
        version: 3,
        requiresClientValidation: true,
      })
      .returning();
    const deliverableId = deliverable?.id ?? "";

    await expect(
      submitDeliverableReview(a.ctx, {
        deliverableId,
        decision: "validated",
        seen: { projectId: a.project.id, version: 2 },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      await db
        .select()
        .from(schema.deliverableReviews)
        .where(eq(schema.deliverableReviews.deliverableId, deliverableId)),
    ).toEqual([]);

    await submitDeliverableReview(a.ctx, {
      deliverableId,
      decision: "validated",
      seen: { projectId: a.project.id, version: 3 },
    });
    const [row] = await db
      .select()
      .from(schema.deliverables)
      .where(eq(schema.deliverables.id, deliverableId));
    expect(row?.status).toBe("validated");
  });

  it("le projet vu d'un autre client ne sert pas de détour", async () => {
    await expect(
      submitDeliverableReview(a.ctx, {
        deliverableId: b.deliverable.id,
        decision: "validated",
        seen: { projectId: b.project.id, version: 1 },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("cloisonnement des compteurs et paramètres d'URL", () => {
  it("marquer lu chez A ne touche pas au compteur de B", async () => {
    const conversations = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.companyId, b.ctx.companyId));
    const id = conversations[0]?.id ?? "";
    await db
      .update(schema.conversations)
      .set({ unreadClient: 3 })
      .where(eq(schema.conversations.id, id));
    await markPortalRead(a.ctx);
    const [row] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id));
    expect(row?.unreadClient).toBe(3);
  });

  it("une page démesurée dans l'URL ne fait pas tomber les documents", async () => {
    const page = await getPortalDocumentsPage(a.ctx, { filter: "tous", page: 1e20 });
    expect(page.documents).toEqual([]);
    expect(page.page).toBe(100_000);
  });
});

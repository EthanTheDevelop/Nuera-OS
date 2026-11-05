import type { PortalContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import {
  createConversation,
  createDocument,
  createPhase,
  createPortalTestContext,
  createProject,
  createSite,
  createTask,
  createTeamMember,
  createTicket,
} from "../../helpers/factories";

/** Marques cherchées telles quelles dans ce qui sort vers un client : aucune ne doit y paraître. */
export const INTERNAL = {
  blocker: "BLOCAGE-INTERNE",
  task: "TACHE-INTERNE",
  note: "NOTE-INTERNE",
  draft: "BROUILLON-INTERNE",
  hiddenPhase: "JALON-CACHE",
  contractor: "SOUS-TRAITANT-CACHE",
  hiddenDocument: "DOCUMENT-INTERNE",
  hiddenInvoice: "FACTURE-CACHEE",
  ticketNote: "REPONSE-INTERNE",
};

export interface ClientWorld {
  ctx: PortalContext;
  companyName: string;
  project: schema.Project;
  deliverable: schema.Deliverable;
  requirement: schema.ClientRequirement;
  sharedDocument: schema.Document;
  internalDocument: schema.Document;
  ticket: schema.Ticket;
  site: schema.Site;
  appointment: schema.Appointment;
}

/** Un client complet : un objet de chaque sorte, partagé ou interne, avec ses marques. */
export async function createClientWorld(db: Database, label: string): Promise<ClientWorld> {
  const client = await createPortalTestContext(db);
  const companyId = client.companyId;
  const owner = await createTeamMember(db, { fullName: `Responsable ${label}`, kind: "partner" });
  const contractor = await createTeamMember(db, {
    fullName: INTERNAL.contractor,
    kind: "contractor",
    hourlyCostCents: 9999,
  });
  const project = await createProject(db, {
    companyId,
    name: `Projet ${label}`,
    status: "blocked",
    ownerMemberId: owner.id,
    budgetCents: 780_000,
    dueOn: "2099-11-18",
    clientStepLabel: "Maquettes",
  });
  await db.insert(schema.projectMembers).values({ projectId: project.id, memberId: contractor.id });
  await createPhase(db, {
    projectId: project.id,
    name: "On démarre",
    status: "in_progress",
    clientVisible: true,
  });
  await createPhase(db, {
    projectId: project.id,
    name: INTERNAL.hiddenPhase,
    clientVisible: false,
  });
  await createTask(db, { projectId: project.id, title: INTERNAL.task });
  await db
    .insert(schema.projectBlockers)
    .values({ projectId: project.id, title: INTERNAL.blocker });

  const { document: sharedDocument } = await createDocument(db, {
    companyId,
    projectId: project.id,
    title: `Maquette ${label}`,
    kind: "mockup",
    visibility: "client",
    status: "to_validate",
  });
  const { document: internalDocument } = await createDocument(db, {
    companyId,
    projectId: project.id,
    title: INTERNAL.hiddenDocument,
    kind: "other",
    visibility: "internal",
  });

  const [deliverable] = await db
    .insert(schema.deliverables)
    .values({
      projectId: project.id,
      title: `Maquette ${label}`,
      status: "to_validate",
      documentId: sharedDocument.id,
      requiresClientValidation: true,
      feedbackRoundsIncluded: 2,
    })
    .returning();
  await db.insert(schema.deliverables).values({
    projectId: project.id,
    title: INTERNAL.draft,
    status: "draft",
    documentId: internalDocument.id,
    requiresClientValidation: true,
  });
  const [requirement] = await db
    .insert(schema.clientRequirements)
    .values({ projectId: project.id, label: `Photos ${label}`, status: "expected" })
    .returning();

  const site = await createSite(db, {
    companyId,
    name: `Site ${label}`,
    primaryDomain: `${label.toLowerCase()}.example`,
    status: "live",
    projectId: project.id,
  });
  const ticket = await createTicket(db, {
    companyId,
    subject: `Demande ${label}`,
    channel: "portal",
    siteId: site.id,
  });
  await db.insert(schema.ticketMessages).values({
    ticketId: ticket.id,
    body: INTERNAL.ticketNote,
    internal: true,
  });

  const [appointment] = await db
    .insert(schema.appointments)
    .values({
      companyId,
      contactId: client.contactId,
      title: `Rendez-vous ${label}`,
      startsAt: new Date("2099-01-15T09:00:00Z"),
      durationMinutes: 30,
      memberIds: [owner.id],
      clientVisible: true,
    })
    .returning();

  await db.insert(schema.financialDocuments).values([
    {
      companyId,
      projectId: project.id,
      source: "manual",
      externalRef: `F-${label}`,
      amountCents: 117_000,
      status: "paid",
      paidOn: "2026-10-24",
      clientVisible: true,
    },
    {
      companyId,
      projectId: project.id,
      source: "manual",
      externalRef: `${INTERNAL.hiddenInvoice}-${label}`,
      amountCents: 5_000,
      clientVisible: false,
    },
  ]);

  const conversation = await createConversation(db, {
    companyId,
    contactId: client.contactId,
  });
  await db.insert(schema.messages).values({
    companyId,
    conversationId: conversation.id,
    direction: "internal",
    body: INTERNAL.note,
    at: new Date(),
  });

  if (!deliverable || !requirement || !appointment) throw new Error("Insertion de test");
  const { db: _db, actor, contactId } = client;
  void _db;
  return {
    ctx: { db, actor, companyId, contactId },
    companyName: client.company.name,
    project,
    deliverable,
    requirement,
    sharedDocument,
    internalDocument,
    ticket,
    site,
    appointment,
  };
}

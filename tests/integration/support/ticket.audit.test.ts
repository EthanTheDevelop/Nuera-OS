import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveCoverage } from "@/modules/contracts/contract.service";
import {
  archiveTicket,
  convertTicket,
  createTicket,
  createTicketFromPortal,
  getCompanyTargets,
  getTicketDetail,
  getTicketFilterLabels,
  getTicketTime,
  listTickets,
  logTicketTime,
  openIncidentTicket,
  refreshTicketCoverage,
  transitionTicket,
  updateTicket,
} from "@/modules/support/ticket.service";
import { parisDay } from "@/modules/support/ticket.sla";
import type { ServiceContext } from "@/server/context";
import * as s from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContract,
  createMemberContext,
  createPortalTestContext,
  createProject,
  createSite,
} from "../../helpers/factories";

/** Défauts trouvés à l'audit du lot : chacun de ces tests échouait avant sa correction. */
let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext & { member: s.TeamMember };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  admin = await createMemberContext(db, "admin");
});
afterAll(async () => close());

let counter = 0;
const newTicket = (ctx: ServiceContext, companyId: string, extra: Record<string, unknown> = {}) =>
  createTicket(ctx, {
    companyId,
    subject: `Audit ${(counter += 1)}`,
    channel: "email",
    category: "assistance",
    severity: "medium",
    ...extra,
  });

async function toResolved(ticketId: string) {
  await transitionTicket(admin, { ticketId, toStatus: "qualified" });
  await transitionTicket(admin, {
    ticketId,
    toStatus: "in_progress",
    assigneeMemberId: admin.member.id,
  });
  await transitionTicket(admin, { ticketId, toStatus: "resolved" });
}

const eventsOf = (ticketId: string) =>
  db.select().from(s.ticketEvents).where(eq(s.ticketEvents.ticketId, ticketId));
const reload = async (ticketId: string) => {
  const [row] = await db.select().from(s.tickets).where(eq(s.tickets.id, ticketId));
  if (!row) throw new Error("Demande absente");
  return row;
};
const auditsOf = (ticketId: string, action: string) =>
  db
    .select()
    .from(s.auditLog)
    .where(and(eq(s.auditLog.entityId, ticketId), eq(s.auditLog.action, action)));

async function incidentSite() {
  const company = await createCompany(db);
  const site = await createSite(db, { companyId: company.id });
  return { company, site };
}

describe("un seul incident ouvert par site, y compris à la main", () => {
  it("rouvrir un incident résolu refuse clairement si un autre est déjà ouvert sur le site", async () => {
    const { site } = await incidentSite();
    const input = { siteId: site.id, title: "Panne", source: "uptime_kuma" };
    const first = await openIncidentTicket(db, input);
    await toResolved(first.id);
    const second = await openIncidentTicket(db, input);
    expect(second.id).not.toBe(first.id);

    await expect(
      transitionTicket(admin, { ticketId: first.id, toStatus: "in_progress" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await reload(first.id)).status).toBe("resolved");

    await toResolved(second.id);
    await transitionTicket(admin, { ticketId: first.id, toStatus: "in_progress" });
    expect((await reload(first.id)).status).toBe("in_progress");
  });

  it("déplacer un incident vers un site qui en a déjà un refuse clairement", async () => {
    const { company, site } = await incidentSite();
    const other = await createSite(db, { companyId: company.id });
    const first = await openIncidentTicket(db, {
      siteId: site.id,
      title: "Panne A",
      source: "coolify",
    });
    await openIncidentTicket(db, { siteId: other.id, title: "Panne B", source: "coolify" });
    await expect(
      updateTicket(admin, {
        ticketId: first.id,
        subject: first.subject,
        siteId: other.id,
        category: first.category,
        severity: first.severity,
        coverage: first.coverage,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await reload(first.id)).siteId).toBe(site.id);
  });
});

describe("forfait au nombre de demandes", () => {
  it("une demande couverte et clôturée sans temps saisi compte dans le quota de demandes", async () => {
    const company = await createCompany(db);
    const contract = await createContract(db, {
      companyId: company.id,
      status: "active",
      startOn: "2026-01-01",
      includedMinutes: null,
      includedTickets: 1,
    });
    const ticket = await newTicket(admin, company.id, { contractId: contract.id });
    await toResolved(ticket.id);
    expect((await reload(ticket.id)).coverage).toBe("covered");
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "closed", note: "Vérifié" });

    const decision = await resolveCoverage(db, {
      companyId: company.id,
      siteId: null,
      contractId: contract.id,
      category: "assistance",
    });
    expect(decision.coverage).toBe("overage");
  });

  it("un forfait en heures ne reçoit pas d'intervention vide", async () => {
    const company = await createCompany(db);
    const contract = await createContract(db, {
      companyId: company.id,
      status: "active",
      startOn: "2026-01-01",
      includedMinutes: 600,
      includedTickets: null,
    });
    const ticket = await newTicket(admin, company.id, { contractId: contract.id });
    await toResolved(ticket.id);
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "closed", note: "Vérifié" });
    const rows = await db
      .select()
      .from(s.maintenanceInterventions)
      .where(eq(s.maintenanceInterventions.ticketId, ticket.id));
    expect(rows).toHaveLength(0);
  });
});

describe("recalcul de la couverture", () => {
  it("rejouer sans changement n'ajoute rien à l'historique", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    await refreshTicketCoverage(admin, ticket.id);
    const once = (await eventsOf(ticket.id)).length;
    await refreshTicketCoverage(admin, ticket.id);
    await refreshTicketCoverage(admin, ticket.id);
    expect(await eventsOf(ticket.id)).toHaveLength(once);
  });

  it("journalise un changement de contrat même si la couverture reste la même", async () => {
    const company = await createCompany(db);
    const contract = await createContract(db, {
      companyId: company.id,
      status: "active",
      startOn: "2026-01-01",
    });
    const ticket = await newTicket(admin, company.id);
    await updateTicket(admin, {
      ticketId: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      severity: ticket.severity,
      coverage: "covered",
    });
    const before = (await auditsOf(ticket.id, "ticket.updated")).length;
    await refreshTicketCoverage(admin, ticket.id);
    expect(await reload(ticket.id)).toMatchObject({ coverage: "covered", contractId: contract.id });
    expect(await auditsOf(ticket.id, "ticket.updated")).toHaveLength(before + 1);
  });

  it("un motif déjà écrit avec la note de qualification ne se répète pas au recalcul", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "qualified", note: "Vu" });
    const before = (await eventsOf(ticket.id)).length;
    await refreshTicketCoverage(admin, ticket.id);
    expect(await eventsOf(ticket.id)).toHaveLength(before);
    const detail = await getTicketDetail(admin, ticket.id);
    expect(detail.coverageReason).toBe("Aucun contrat pour ce client.");
  });
});

describe("identifiants reçus du navigateur", () => {
  it("un identifiant mal formé répond 404, jamais une erreur SQL", async () => {
    await expect(refreshTicketCoverage(admin, "pas-un-id")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(archiveTicket(admin, "pas-un-id")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getCompanyTargets(admin, "pas-un-id")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("archiver deux fois ne fait rien de plus", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    const first = await archiveTicket(admin, ticket.id);
    const again = await archiveTicket(admin, ticket.id);
    expect(again.archivedAt?.getTime()).toBe(first.archivedAt?.getTime());
    expect(await auditsOf(ticket.id, "ticket.archived")).toHaveLength(1);
  });
});

describe("modification d'une fiche", () => {
  it("un champ de rattachement absent garde le lien, un champ vide le retire", async () => {
    const company = await createCompany(db);
    const site = await createSite(db, { companyId: company.id });
    const project = await createProject(db, { companyId: company.id });
    const ticket = await newTicket(admin, company.id, {
      siteId: site.id,
      projectId: project.id,
      description: "Détail",
    });
    const base = {
      ticketId: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      severity: ticket.severity,
      coverage: ticket.coverage,
    };
    await updateTicket(admin, base);
    expect(await reload(ticket.id)).toMatchObject({
      siteId: site.id,
      projectId: project.id,
      description: "Détail",
    });
    await updateTicket(admin, { ...base, siteId: "", projectId: "" });
    expect(await reload(ticket.id)).toMatchObject({ siteId: null, projectId: null });
  });

  it("quitter un contrat à délais retire l'échéance qu'il avait fixée", async () => {
    const company = await createCompany(db);
    const contract = await createContract(db, {
      companyId: company.id,
      status: "active",
      startOn: "2026-01-01",
      responseHours: 4,
      resolutionHours: 24,
    });
    const ticket = await newTicket(admin, company.id, { contractId: contract.id });
    expect(ticket.dueAt).not.toBeNull();
    await updateTicket(admin, {
      ticketId: ticket.id,
      subject: ticket.subject,
      contractId: "",
      category: ticket.category,
      severity: ticket.severity,
      coverage: ticket.coverage,
    });
    expect((await reload(ticket.id)).dueAt).toBeNull();
  });

  it("renvoyer le même jour d'échéance ne déplace pas son heure", async () => {
    const company = await createCompany(db);
    const contract = await createContract(db, {
      companyId: company.id,
      status: "active",
      startOn: "2026-01-01",
      responseHours: 4,
    });
    const ticket = await newTicket(admin, company.id, { contractId: contract.id });
    const due = ticket.dueAt;
    expect(due).not.toBeNull();
    // Le contrat cesse de fixer les délais : l'échéance déjà posée s'affiche à la journée.
    await db
      .update(s.contracts)
      .set({ responseHours: null })
      .where(eq(s.contracts.id, contract.id));
    await updateTicket(admin, {
      ticketId: ticket.id,
      subject: ticket.subject,
      contractId: contract.id,
      category: ticket.category,
      severity: ticket.severity,
      coverage: ticket.coverage,
      dueOn: parisDay(due as Date),
    });
    expect((await reload(ticket.id)).dueAt?.getTime()).toBe(due?.getTime());
  });

  it("refuse le site, le contrat ou le projet d'un autre client", async () => {
    const [mine, theirs] = await Promise.all([createCompany(db), createCompany(db)]);
    const ticket = await newTicket(admin, mine.id);
    const site = await createSite(db, { companyId: theirs.id });
    const contract = await createContract(db, { companyId: theirs.id });
    const project = await createProject(db, { companyId: theirs.id });
    const base = {
      ticketId: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      severity: ticket.severity,
      coverage: ticket.coverage,
    };
    for (const link of [
      { siteId: site.id },
      { contractId: contract.id },
      { projectId: project.id },
    ]) {
      await expect(updateTicket(admin, { ...base, ...link })).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
    expect(await reload(ticket.id)).toMatchObject({
      siteId: null,
      contractId: null,
      projectId: null,
    });
  });
});

describe("nouveaux rattachements", () => {
  it("une création ne vise ni un site archivé, ni un contrat résilié, ni un projet archivé", async () => {
    const company = await createCompany(db);
    const site = await createSite(db, { companyId: company.id, archivedAt: new Date() });
    const contract = await createContract(db, { companyId: company.id, status: "terminated" });
    const project = await createProject(db, { companyId: company.id, archivedAt: new Date() });
    for (const link of [
      { siteId: site.id },
      { contractId: contract.id },
      { projectId: project.id },
    ]) {
      await expect(newTicket(admin, company.id, link)).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
  });

  it("modifier une fiche garde un lien déjà posé vers un contrat résilié, sans en poser de nouveau", async () => {
    const company = await createCompany(db);
    const active = await createContract(db, {
      companyId: company.id,
      status: "active",
      startOn: "2026-01-01",
    });
    const ticket = await newTicket(admin, company.id, { contractId: active.id });
    await db.update(s.contracts).set({ status: "terminated" }).where(eq(s.contracts.id, active.id));
    const base = {
      ticketId: ticket.id,
      subject: "Objet modifié",
      category: ticket.category,
      severity: ticket.severity,
      coverage: ticket.coverage,
    };
    await updateTicket(admin, { ...base, contractId: active.id });
    expect((await reload(ticket.id)).contractId).toBe(active.id);

    const other = await createContract(db, { companyId: company.id, status: "terminated" });
    await expect(updateTicket(admin, { ...base, contractId: other.id })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("le portail ne vise pas un site archivé", async () => {
    const portal = await createPortalTestContext(db);
    const site = await createSite(db, { companyId: portal.companyId, archivedAt: new Date() });
    await expect(
      createTicketFromPortal(portal, { subject: "Mon site", siteId: site.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("filtres de l'écran", () => {
  it("isole les incidents et les demandes hors contrat", async () => {
    const { company, site } = await incidentSite();
    const incident = await openIncidentTicket(db, {
      siteId: site.id,
      title: "Panne",
      source: "coolify",
    });
    const plain = await newTicket(admin, company.id);
    await transitionTicket(admin, { ticketId: plain.id, toStatus: "qualified" });
    expect((await reload(plain.id)).coverage).toBe("not_covered");

    const incidents = await listTickets(admin, { filtre: "incidents", client: company.id });
    expect(incidents.items.map((row) => row.id)).toEqual([incident.id]);
    const outside = await listTickets(admin, { filtre: "hors_contrat", client: company.id });
    expect(outside.items.map((row) => row.id)).toEqual([plain.id]);
  });

  it("nomme le client ou le site filtré pour qui voit tout, sans rien révéler au prestataire", async () => {
    const { company, site } = await incidentSite();
    const contractor = await createMemberContext(db, "contractor");
    const query = { client: company.id, site: site.id };
    expect(await getTicketFilterLabels(admin, query)).toMatchObject({
      client: company.name,
      site: site.primaryDomain ?? site.name,
    });
    expect(await getTicketFilterLabels(contractor, query)).toEqual({ client: null, site: null });
  });
});

describe("devis lié à une demande", () => {
  it("son numéro ne sort que pour qui peut l'ouvrir", async () => {
    const contractor = await createMemberContext(db, "contractor");
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id, {
      assigneeMemberId: contractor.member.id,
    });
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "qualified" });
    await convertTicket(admin, { ticketId: ticket.id, target: "quote" });

    expect((await getTicketDetail(admin, ticket.id)).changeRequest?.quoteNumber).toBeTruthy();
    const seen = await getTicketDetail(contractor, ticket.id);
    expect(seen.changeRequest).toMatchObject({ quoteId: null, quoteNumber: null });
  });
});

describe("le coût reste hors de la fiche", () => {
  it("rien du tarif ni du coût n'est lisible par un prestataire sur sa demande", async () => {
    const contractor = await createMemberContext(db, "contractor");
    const company = await createCompany(db);
    const contract = await createContract(db, {
      companyId: company.id,
      status: "active",
      startOn: "2026-01-01",
      priceCents: 123_456,
      monthlyCostCents: 65_432,
    });
    const ticket = await newTicket(admin, company.id, {
      contractId: contract.id,
      assigneeMemberId: contractor.member.id,
    });
    await logTicketTime(contractor, {
      ticketId: ticket.id,
      minutes: 30,
      workOn: parisDay(new Date()),
      billable: true,
    });
    const readable = JSON.stringify([
      await getTicketDetail(contractor, ticket.id),
      await getTicketTime(contractor, ticket.id),
      await listTickets(contractor, {}),
    ]);
    expect(readable).not.toMatch(/hourlyCost|priceCents|monthlyCost|amountCents|123456|65432/);
  });
});

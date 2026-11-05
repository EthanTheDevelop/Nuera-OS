import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createContract,
  getContractRecord,
  changeContractStatus,
  linkContractSite,
} from "@/modules/contracts/contract.service";
import { createIntervention, listInterventions } from "@/modules/contracts/intervention.service";
import { dispatchPendingEvents } from "@/modules/platform/automation.service";
import { listChangeRequestsForCompany } from "@/modules/projects/production.service";
import { getQuoteDetail } from "@/modules/quotes/quote.service";
import { createSite } from "@/modules/sites/site.service";
import {
  convertTicket,
  createTicket,
  getTicketDetail,
  logTicketTime,
  transitionTicket,
} from "@/modules/support/ticket.service";
import { getTimeEntry, listTimeEntriesForCompany } from "@/modules/time/time.service";
import * as s from "@/server/db/schema";
import { ConflictError } from "@/server/errors";
import { createCompany } from "../helpers/factories";
import { createJourneyWorld, eventsOf, notificationsOf, type JourneyWorld } from "./world";

const TODAY = new Date().toISOString().slice(0, 10);

describe("parcours 3 : site ou contrat → demande → intervention → temps et forfait → clôture", () => {
  let world: JourneyWorld;
  let company: s.Company;
  let site: s.Site;
  let contract: s.Contract;

  beforeAll(async () => {
    world = await createJourneyWorld();
    const { admin, member, db } = world;
    company = await createCompany(db, { status: "client" });
    site = await createSite(member, { companyId: company.id, name: "Site suivi" });
    contract = await createContract(admin, {
      companyId: company.id,
      name: "Maintenance suivie",
      kind: "maintenance",
      priceCents: 12_000,
      period: "monthly",
      startOn: "2026-01-01",
      includedMinutes: 60,
      scope: "Correctifs",
    });
    await linkContractSite(admin, contract.id, { siteId: site.id });
    await changeContractStatus(admin, contract.id, { status: "active" });
  });
  afterAll(async () => world.close());

  async function openQualified(subject: string) {
    const { member } = world;
    const ticket = await createTicket(member, {
      companyId: company.id,
      siteId: site.id,
      subject,
      channel: "email",
      category: "bug",
      severity: "medium",
    });
    return transitionTicket(member, { ticketId: ticket.id, toStatus: "qualified" });
  }

  it("impute le temps au forfait une seule fois, et le contrat le montre", async () => {
    const { admin, member, viewer, db } = world;
    const memberId = (member as unknown as { member: s.TeamMember }).member.id;

    const qualified = await openQualified("Formulaire cassé");
    expect(qualified).toMatchObject({ coverage: "covered", contractId: contract.id });

    await transitionTicket(member, {
      ticketId: qualified.id,
      toStatus: "in_progress",
      assigneeMemberId: memberId,
    });

    // Le temps saisi sur la demande arrive dans le module Temps, sur le bon client et le bon contrat.
    const logged = await logTicketTime(member, {
      ticketId: qualified.id,
      minutes: 50,
      workOn: TODAY,
      billable: false,
    });
    const entry = await getTimeEntry(admin, logged.id);
    expect(entry).toMatchObject({ minutes: 50, ticketId: qualified.id, companyId: company.id });
    const byClient = await listTimeEntriesForCompany(admin, company.id);
    expect(byClient.map((row) => row.id)).toContain(logged.id);

    // Tant que la demande n'est pas clôturée, le forfait n'a rien consommé.
    expect((await getContractRecord(admin, contract.id)).consumption.consumedMinutes).toBe(0);

    await transitionTicket(member, { ticketId: qualified.id, toStatus: "resolved" });
    await expect(
      transitionTicket(member, { ticketId: qualified.id, toStatus: "closed" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const closed = await transitionTicket(member, {
      ticketId: qualified.id,
      toStatus: "closed",
      note: "Formulaire testé en production.",
    });
    expect(closed.closedAt).not.toBeNull();
    await transitionTicket(member, {
      ticketId: qualified.id,
      toStatus: "closed",
      note: "Rejoué.",
    });

    // La clôture écrit l'intervention : une seule ligne, avec les minutes réelles.
    const interventions = await listInterventions(admin, contract.id, { page: 1, pageSize: 25 });
    const onTicket = interventions.items.filter((row) =>
      row.title.startsWith(`Demande ${qualified.number}`),
    );
    expect(onTicket).toHaveLength(1);
    expect(onTicket[0]).toMatchObject({ minutes: 50, doneOn: TODAY });

    const record = await getContractRecord(admin, contract.id);
    expect(record.consumption.consumedMinutes).toBe(50);
    expect(record.consumption.consumedTickets).toBeGreaterThanOrEqual(0);
    expect(record.tickets?.find((row) => row.id === qualified.id)?.status).toBe("closed");

    // Le temps d'une demande clôturée est refusé, le forfait ne bouge plus.
    await expect(
      logTicketTime(member, { ticketId: qualified.id, minutes: 5, workOn: TODAY, billable: false }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await eventsOf(db, "ticket.closed", qualified.id)).toHaveLength(1);
    const detail = await getTicketDetail(viewer, qualified.id);
    expect(detail.ticket.status).toBe("closed");

    // 50 min sur 60 : le seuil de 80 % est passé, une seule alerte malgré un second répartiteur.
    expect(await eventsOf(db, "contract.quota_80", contract.id)).toHaveLength(1);
    await dispatchPendingEvents(db);
    await dispatchPendingEvents(db);
    const alerts = (await notificationsOf(db, admin.actor.userId)).filter(
      (row) => row.kind === "contract" && row.entityId === contract.id,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.href).toBe(`/contrats/${contract.id}`);
  });

  it("au-delà du forfait, la demande passe hors forfait et devient une demande de changement", async () => {
    const { admin, member, viewer, db } = world;
    const memberId = (member as unknown as { member: s.TeamMember }).member.id;

    // Une intervention hors demande compte aussi : le forfait s'épuise (50 + 5 + 20 sur 60).
    await createIntervention(admin, contract.id, {
      siteId: site.id,
      title: "Mise à jour du CMS",
      doneOn: TODAY,
      minutes: 5,
    });
    const second = await openQualified("Bandeau à revoir");
    expect(second.coverage).toBe("covered");
    await transitionTicket(member, {
      ticketId: second.id,
      toStatus: "in_progress",
      assigneeMemberId: memberId,
    });
    await logTicketTime(member, {
      ticketId: second.id,
      minutes: 20,
      workOn: TODAY,
      billable: false,
    });
    await transitionTicket(member, { ticketId: second.id, toStatus: "resolved" });
    await transitionTicket(member, { ticketId: second.id, toStatus: "closed", note: "Vérifié." });
    expect((await getContractRecord(admin, contract.id)).consumption.consumedMinutes).toBe(75);
    expect(await eventsOf(db, "contract.quota_exceeded", contract.id)).toHaveLength(1);

    // La demande suivante est hors forfait : l'équipe le voit à la qualification.
    const third = await openQualified("Nouvelle page Recrutement");
    expect(third.coverage).toBe("overage");

    // Transformée : une demande de changement liée, sans doublon si le geste est rejoué.
    const change = await convertTicket(member, { ticketId: third.id, target: "change_request" });
    const again = await convertTicket(member, { ticketId: third.id, target: "change_request" });
    expect(again.id).toBe(change.id);
    const listed = await listChangeRequestsForCompany(admin, company.id);
    expect(listed.filter((row) => row.id === change.id)).toHaveLength(1);
    const [row] = await db
      .select()
      .from(s.changeRequests)
      .where(eq(s.changeRequests.id, change.id));
    expect(row).toMatchObject({ ticketId: third.id, status: "open", companyId: company.id });

    // Puis en devis : le devis retrouve la demande, la demande garde son lien.
    const withQuote = await convertTicket(member, { ticketId: third.id, target: "quote" });
    expect(withQuote.id).toBe(change.id);
    expect(withQuote.quoteId).not.toBeNull();
    const quote = await getQuoteDetail(viewer, withQuote.quoteId ?? "");
    expect(quote.quote).toMatchObject({ companyId: company.id, status: "draft" });

    const detail = await getTicketDetail(viewer, third.id);
    expect(detail.ticket.changeRequestId).toBe(change.id);
    expect(detail.changeRequest).toMatchObject({ id: change.id, quoteId: withQuote.quoteId });
  });
});

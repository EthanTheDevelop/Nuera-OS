import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TICKET_STATUSES, type TicketStatus } from "@/lib/domain-enums";
import type * as ContractService from "@/modules/contracts/contract.service";
import { consumeContractQuota, resolveCoverage } from "@/modules/contracts/contract.service";
import {
  addPortalTicketMessage,
  addTicketComment,
  addTicketMessage,
  archiveTicket,
  assignTicket,
  convertTicket,
  createTicket,
  createTicketFromPortal,
  getSupportBoard,
  getSupportOverview,
  getSupportSummary,
  getTicketAttachments,
  getTicketComments,
  getTicketDetail,
  getTicketForPortal,
  getTicketRecurrence,
  getTicketTime,
  listTickets,
  listTicketsForCompany,
  listTicketsForPortal,
  listTicketsNearingDue,
  logTicketTime,
  openIncidentTicket,
  refreshTicketCoverage,
  transitionTicket,
  updateTicket,
} from "@/modules/support/ticket.service";
import {
  computeDueAt,
  endOfParisDay,
  isTicketOverdue,
  parisDay,
  startOfParisMonth,
} from "@/modules/support/ticket.sla";
import { canTicketTransition, TICKET_TRANSITIONS } from "@/modules/support/ticket.status";
import type { ServiceContext } from "@/server/context";
import * as s from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContract,
  createMemberContext,
  createPortalTestContext,
  createSite,
  createTeamMember,
  createTicket as insertRawTicket,
} from "../../helpers/factories";

vi.mock("@/modules/contracts/contract.service", async (importOriginal) => {
  const actual = await importOriginal<typeof ContractService>();
  return {
    ...actual,
    consumeContractQuota: vi.fn(actual.consumeContractQuota),
    resolveCoverage: vi.fn(actual.resolveCoverage),
  };
});

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext & { member: s.TeamMember };
let viewer: ServiceContext;

const HOUR = 3_600_000;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  admin = await createMemberContext(db, "admin");
  viewer = await createTestContext(db, "viewer");
});
afterAll(async () => close());

beforeEach(() => {
  vi.mocked(consumeContractQuota).mockClear();
});

let subjectCounter = 0;
const subject = () => `Demande de test ${(subjectCounter += 1)}`;

/** Un client, un site et un contrat de maintenance en vigueur rattaché au site. */
async function coveredClient(overrides: Partial<typeof s.contracts.$inferInsert> = {}) {
  const company = await createCompany(db);
  const contract = await createContract(db, {
    companyId: company.id,
    status: "active",
    startOn: "2026-01-01",
    includedMinutes: 600,
    responseHours: 4,
    resolutionHours: 24,
    ...overrides,
  });
  const site = await createSite(db, { companyId: company.id, contractId: contract.id });
  await db
    .insert(s.contractSites)
    .values({ contractId: contract.id, siteId: site.id, companyId: company.id });
  return { company, contract, site };
}

function newTicket(ctx: ServiceContext, companyId: string, extra: Record<string, unknown> = {}) {
  return createTicket(ctx, {
    companyId,
    subject: subject(),
    channel: "email",
    category: "assistance",
    severity: "medium",
    ...extra,
  });
}

/** Amène une demande à un état en passant par la machine, jamais en écrivant directement. */
async function advance(ctx: ServiceContext, ticketId: string, to: TicketStatus) {
  const path: TicketStatus[] = ["qualified", "in_progress", "resolved"];
  for (const status of path) {
    await transitionTicket(ctx, {
      ticketId,
      toStatus: status,
      assigneeMemberId: status === "in_progress" ? admin.member.id : undefined,
    });
    if (status === to) return;
  }
}

const eventsOf = (ticketId: string) =>
  db.select().from(s.ticketEvents).where(eq(s.ticketEvents.ticketId, ticketId));

const domainEventsOf = (ticketId: string, type: string) =>
  db
    .select()
    .from(s.domainEvents)
    .where(and(eq(s.domainEvents.entityId, ticketId), eq(s.domainEvents.type, type)));

const auditsOf = (ticketId: string, action: string) =>
  db
    .select()
    .from(s.auditLog)
    .where(and(eq(s.auditLog.entityId, ticketId), eq(s.auditLog.action, action)));

const reload = async (ticketId: string) => {
  const [row] = await db.select().from(s.tickets).where(eq(s.tickets.id, ticketId));
  if (!row) throw new Error("Demande absente");
  return row;
};

describe("machine à états", () => {
  it("n'autorise que le parcours du cadrage (A5)", () => {
    const allowed = TICKET_STATUSES.flatMap((from) =>
      TICKET_STATUSES.filter((to) => canTicketTransition(from, to)).map((to) => `${from}>${to}`),
    );
    expect(allowed.sort()).toEqual(
      [
        "received>qualified",
        "qualified>in_progress",
        "in_progress>resolved",
        "resolved>in_progress",
        "resolved>closed",
      ].sort(),
    );
    expect(TICKET_TRANSITIONS.closed).toEqual([]);
  });

  it("refuse un saut d'étape", async () => {
    const { company } = await coveredClient();
    const ticket = await newTicket(admin, company.id);
    await expect(
      transitionTicket(admin, { ticketId: ticket.id, toStatus: "resolved" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      transitionTicket(admin, { ticketId: ticket.id, toStatus: "closed", note: "Vu" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await reload(ticket.id)).status).toBe("received");
  });
});

describe("création", () => {
  it("numérote, trace, journalise et émet ticket.created dans la même opération", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    expect(ticket.number).toMatch(/^T-\d{4}-\d{3,}$/);
    expect(ticket.status).toBe("received");
    expect(ticket.openedByUserId).toBe(admin.actor.userId);
    const [event] = await eventsOf(ticket.id);
    expect(event).toMatchObject({ fromStatus: null, toStatus: "received" });
    expect(await domainEventsOf(ticket.id, "ticket.created")).toHaveLength(1);
    expect(await domainEventsOf(ticket.id, "ticket.critical")).toHaveLength(0);
    expect(await auditsOf(ticket.id, "ticket.created")).toHaveLength(1);
  });

  it("un double envoi identique ne crée qu'une demande", async () => {
    const company = await createCompany(db);
    const input = {
      companyId: company.id,
      subject: subject(),
      channel: "phone" as const,
      category: "question" as const,
      severity: "low" as const,
    };
    const first = await createTicket(admin, input);
    const second = await createTicket(admin, input);
    expect(second.id).toBe(first.id);
    expect(await domainEventsOf(first.id, "ticket.created")).toHaveLength(1);
  });

  it("une demande critique émet ticket.critical, une seule fois même si la gravité change", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id, { severity: "critical" });
    expect(await domainEventsOf(ticket.id, "ticket.critical")).toHaveLength(1);

    const later = await newTicket(admin, company.id);
    const edit = {
      ticketId: later.id,
      subject: later.subject,
      category: later.category,
      coverage: later.coverage,
    };
    await updateTicket(admin, { ...edit, severity: "critical" });
    await updateTicket(admin, { ...edit, severity: "high" });
    await updateTicket(admin, { ...edit, severity: "critical" });
    expect(await domainEventsOf(later.id, "ticket.critical")).toHaveLength(1);
  });

  it("refuse le site, le contrat ou le projet d'un autre client", async () => {
    const a = await coveredClient();
    const b = await coveredClient();
    await expect(newTicket(admin, a.company.id, { siteId: b.site.id })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { siteId: expect.any(Array) },
    });
    await expect(
      newTicket(admin, a.company.id, { contractId: b.contract.id }),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { contractId: expect.any(Array) } });
  });

  it("refuse un client inconnu et une saisie invalide", async () => {
    await expect(newTicket(admin, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const company = await createCompany(db);
    await expect(newTicket(admin, company.id, { subject: "x" })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { subject: expect.any(Array) },
    });
  });
});

describe("délais contractuels", () => {
  it("calcule l'échéance : première réponse, puis résolution", () => {
    const opened = new Date("2026-03-01T10:00:00Z");
    const sla = { responseHours: 4, resolutionHours: 24 };
    expect(computeDueAt(opened, sla, null)).toEqual(new Date("2026-03-01T14:00:00Z"));
    expect(computeDueAt(opened, sla, new Date("2026-03-01T11:00:00Z"))).toEqual(
      new Date("2026-03-02T10:00:00Z"),
    );
    expect(computeDueAt(opened, { responseHours: null, resolutionHours: 8 }, null)).toEqual(
      new Date("2026-03-01T18:00:00Z"),
    );
    expect(computeDueAt(opened, { responseHours: 12, resolutionHours: 2 }, null)).toEqual(
      new Date("2026-03-01T12:00:00Z"),
    );
    expect(computeDueAt(opened, { responseHours: null, resolutionHours: null }, null)).toBeNull();
  });

  it("place les dates à l'heure de Paris, été comme hiver", () => {
    expect(endOfParisDay("2026-07-14")).toEqual(new Date("2026-07-14T21:59:00Z"));
    expect(endOfParisDay("2026-01-14")).toEqual(new Date("2026-01-14T22:59:00Z"));
    expect(startOfParisMonth(new Date("2026-07-14T12:00:00Z"))).toEqual(
      new Date("2026-06-30T22:00:00Z"),
    );
    expect(parisDay(new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
  });

  it("une résolue n'est pas en retard, une ouverte oui", () => {
    const now = new Date("2026-03-02T00:00:00Z");
    const dueAt = new Date("2026-03-01T00:00:00Z");
    expect(isTicketOverdue({ status: "in_progress", dueAt }, now)).toBe(true);
    expect(isTicketOverdue({ status: "resolved", dueAt }, now)).toBe(false);
    expect(isTicketOverdue({ status: "in_progress", dueAt: null }, now)).toBe(false);
  });

  it("applique le contrat du site dès la création", async () => {
    const { company, contract, site } = await coveredClient();
    const ticket = await newTicket(admin, company.id, { siteId: site.id });
    expect(ticket.contractId).toBe(contract.id);
    expect(ticket.dueAt?.getTime()).toBe(ticket.createdAt.getTime() + 4 * HOUR);
  });

  it("n'applique pas les délais d'un contrat résilié", async () => {
    const { company, site } = await coveredClient({ status: "terminated" });
    const ticket = await newTicket(admin, company.id, { siteId: site.id });
    expect(ticket.dueAt).toBeNull();
  });

  it("une réponse au client passe au délai de résolution, une note interne non", async () => {
    const { company, site } = await coveredClient();
    const ticket = await newTicket(admin, company.id, { siteId: site.id });

    await addTicketMessage(admin, { ticketId: ticket.id, body: "Note d'équipe", internal: true });
    let current = await reload(ticket.id);
    expect(current.firstResponseAt).toBeNull();
    expect(current.dueAt?.getTime()).toBe(ticket.createdAt.getTime() + 4 * HOUR);

    await addTicketMessage(admin, { ticketId: ticket.id, body: "Bien reçu", internal: false });
    current = await reload(ticket.id);
    const firstResponse = current.firstResponseAt;
    expect(firstResponse).not.toBeNull();
    expect(current.dueAt?.getTime()).toBe(ticket.createdAt.getTime() + 24 * HOUR);

    await addTicketMessage(admin, { ticketId: ticket.id, body: "Autre réponse", internal: false });
    expect((await reload(ticket.id)).firstResponseAt).toEqual(firstResponse);
  });

  it("une échéance convenue à la main cède devant les délais du contrat", async () => {
    const free = await createCompany(db);
    const manual = await newTicket(admin, free.id);
    const updated = await updateTicket(admin, {
      ticketId: manual.id,
      subject: manual.subject,
      category: manual.category,
      severity: manual.severity,
      coverage: manual.coverage,
      dueOn: "2026-12-24",
    });
    expect(updated.dueAt).toEqual(endOfParisDay("2026-12-24"));

    const { company, site } = await coveredClient();
    const contractual = await newTicket(admin, company.id, { siteId: site.id });
    const kept = await updateTicket(admin, {
      ticketId: contractual.id,
      subject: contractual.subject,
      siteId: contractual.siteId,
      contractId: contractual.contractId,
      category: contractual.category,
      severity: contractual.severity,
      coverage: contractual.coverage,
      dueOn: "2026-12-24",
    });
    expect(kept.dueAt).toEqual(contractual.dueAt);
  });

  it("une échéance convenue à la main survit à la décision de couverture sans délais", async () => {
    const free = await createCompany(db);
    const manual = await newTicket(admin, free.id);
    await updateTicket(admin, {
      ticketId: manual.id,
      subject: manual.subject,
      category: manual.category,
      severity: manual.severity,
      coverage: manual.coverage,
      dueOn: "2026-12-24",
    });
    const qualified = await transitionTicket(admin, { ticketId: manual.id, toStatus: "qualified" });
    expect(qualified.dueAt).toEqual(endOfParisDay("2026-12-24"));
    const refreshed = await refreshTicketCoverage(admin, manual.id);
    expect(refreshed.dueAt).toEqual(endOfParisDay("2026-12-24"));
  });

  it("liste ce qui arrive à échéance, sans ce qui est résolu", async () => {
    const company = await createCompany(db);
    const now = new Date();
    const near = await insertRawTicket(db, {
      companyId: company.id,
      status: "in_progress",
      dueAt: new Date(now.getTime() + HOUR),
    });
    const late = await insertRawTicket(db, {
      companyId: company.id,
      status: "received",
      dueAt: new Date(now.getTime() - HOUR),
    });
    const far = await insertRawTicket(db, {
      companyId: company.id,
      status: "received",
      dueAt: new Date(now.getTime() + 48 * HOUR),
    });
    const done = await insertRawTicket(db, {
      companyId: company.id,
      status: "resolved",
      dueAt: new Date(now.getTime() - HOUR),
    });
    const ids = (await listTicketsNearingDue(db, now)).map((row) => row.id);
    expect(ids).toContain(near.id);
    expect(ids).toContain(late.id);
    expect(ids).not.toContain(far.id);
    expect(ids).not.toContain(done.id);
    expect((await listTicketsNearingDue(db, now, { withinHours: 72 })).map((r) => r.id)).toContain(
      far.id,
    );
  });
});

describe("couverture et qualification", () => {
  it("qualifier interroge les contrats et recopie la décision", async () => {
    const { company, contract, site } = await coveredClient();
    const ticket = await newTicket(admin, company.id, { siteId: site.id });
    const qualified = await transitionTicket(admin, { ticketId: ticket.id, toStatus: "qualified" });
    expect(qualified).toMatchObject({ coverage: "covered", contractId: contract.id });
    expect(qualified.dueAt?.getTime()).toBe(ticket.createdAt.getTime() + 4 * HOUR);
    const detail = await getTicketDetail(admin, ticket.id);
    expect(detail.coverageReason).toContain(contract.number);
    expect(detail.sla).toEqual({ responseHours: 4, resolutionHours: 24 });
    expect(await auditsOf(ticket.id, "ticket.coverage_changed")).toHaveLength(1);
  });

  it("sans contrat : non couverte, sans échéance", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    const qualified = await transitionTicket(admin, { ticketId: ticket.id, toStatus: "qualified" });
    expect(qualified).toMatchObject({ coverage: "not_covered", contractId: null, dueAt: null });
  });

  it("une évolution est hors contrat, le quota épuisé donne hors forfait", async () => {
    const { company, site } = await coveredClient();
    const change = await newTicket(admin, company.id, { siteId: site.id, category: "change" });
    expect(
      (await transitionTicket(admin, { ticketId: change.id, toStatus: "qualified" })).coverage,
    ).toBe("not_covered");

    const spent = await coveredClient({ includedMinutes: 30 });
    await consumeContractQuota(db, { contractId: spent.contract.id, minutes: 60, ticketId: null });
    const over = await newTicket(admin, spent.company.id, { siteId: spent.site.id });
    expect(
      (await transitionTicket(admin, { ticketId: over.id, toStatus: "qualified" })).coverage,
    ).toBe("overage");
  });

  it("recalcule la couverture à la demande, sans changer l'état", async () => {
    const { company, site } = await coveredClient();
    const ticket = await newTicket(admin, company.id, { siteId: site.id });
    const refreshed = await refreshTicketCoverage(admin, ticket.id);
    expect(refreshed.coverage).toBe("covered");
    expect((await reload(ticket.id)).status).toBe("received");
  });

  it("une panne de la décision de couverture laisse la demande dans son état", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    const before = (await eventsOf(ticket.id)).length;
    vi.mocked(resolveCoverage).mockRejectedValueOnce(new Error("Contrats indisponibles"));
    await expect(
      transitionTicket(admin, { ticketId: ticket.id, toStatus: "qualified" }),
    ).rejects.toThrow("Contrats indisponibles");
    expect((await reload(ticket.id)).status).toBe("received");
    expect(await eventsOf(ticket.id)).toHaveLength(before);
  });

  it("une attribution invalide annule le changement d'état", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    await expect(
      transitionTicket(admin, {
        ticketId: ticket.id,
        toStatus: "qualified",
        assigneeMemberId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await reload(ticket.id)).status).toBe("received");
  });
});

describe("parcours et règles d'état", () => {
  it("exige un responsable avant la prise en charge", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "qualified" });
    await expect(
      transitionTicket(admin, { ticketId: ticket.id, toStatus: "in_progress" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await assignTicket(admin, { ticketId: ticket.id, assigneeMemberId: admin.member.id });
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "in_progress" });
    await expect(
      assignTicket(admin, { ticketId: ticket.id, assigneeMemberId: null }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("attribue et prend en charge d'un seul geste", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "qualified" });
    const started = await transitionTicket(admin, {
      ticketId: ticket.id,
      toStatus: "in_progress",
      assigneeMemberId: admin.member.id,
    });
    expect(started.assigneeMemberId).toBe(admin.member.id);
    expect(await auditsOf(ticket.id, "ticket.assigned")).toHaveLength(1);
  });

  it("refuse l'attribution à un membre archivé ou inactif", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    const gone = await createTeamMember(db, { status: "inactive" });
    await expect(
      assignTicket(admin, { ticketId: ticket.id, assigneeMemberId: gone.id }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejouer le même état ne fait rien, attribuer deux fois non plus", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "qualified" });
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "qualified" });
    expect(await eventsOf(ticket.id)).toHaveLength(2);

    await assignTicket(admin, { ticketId: ticket.id, assigneeMemberId: admin.member.id });
    await assignTicket(admin, { ticketId: ticket.id, assigneeMemberId: admin.member.id });
    expect(await auditsOf(ticket.id, "ticket.assigned")).toHaveLength(1);
  });

  it("parcourt tous les états, rouvre une résolue, ne rouvre pas une clôturée", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    await advance(admin, ticket.id, "resolved");
    const resolved = await reload(ticket.id);
    expect(resolved.resolvedAt).not.toBeNull();

    const reopened = await transitionTicket(admin, {
      ticketId: ticket.id,
      toStatus: "in_progress",
    });
    expect(reopened.resolvedAt).toBeNull();
    const events = await eventsOf(ticket.id);
    expect(events.at(-1)).toMatchObject({
      fromStatus: "resolved",
      toStatus: "in_progress",
      note: "Rouverte",
    });

    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "resolved" });
    const closed = await transitionTicket(admin, {
      ticketId: ticket.id,
      toStatus: "closed",
      note: "Vérifié en production",
    });
    expect(closed.closedAt).not.toBeNull();
    await expect(
      transitionTicket(admin, { ticketId: ticket.id, toStatus: "in_progress" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      updateTicket(admin, {
        ticketId: ticket.id,
        subject: "Autre objet",
        category: "bug",
        severity: "low",
        coverage: "covered",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      addTicketMessage(admin, { ticketId: ticket.id, body: "Encore", internal: false }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      logTicketTime(admin, {
        ticketId: ticket.id,
        minutes: 10,
        workOn: parisDay(new Date()),
        billable: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("une clôture exige une note de vérification et émet ticket.closed une seule fois", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    await advance(admin, ticket.id, "resolved");
    await expect(
      transitionTicket(admin, { ticketId: ticket.id, toStatus: "closed" }),
    ).rejects.toMatchObject({ code: "CONFLICT", fieldErrors: { note: expect.any(Array) } });
    await expect(
      transitionTicket(admin, { ticketId: ticket.id, toStatus: "closed", note: "   " }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await reload(ticket.id)).status).toBe("resolved");

    const input = {
      ticketId: ticket.id,
      toStatus: "closed" as const,
      note: "Testé avec le client",
    };
    await transitionTicket(admin, input);
    await transitionTicket(admin, input);
    expect(await domainEventsOf(ticket.id, "ticket.closed")).toHaveLength(1);
    expect(await auditsOf(ticket.id, "ticket.closed")).toHaveLength(1);
    expect((await eventsOf(ticket.id)).at(-1)?.note).toBe("Testé avec le client");
  });
});

describe("temps et forfait", () => {
  const today = () => parisDay(new Date());

  async function resolvedCovered() {
    const client = await coveredClient();
    const ticket = await newTicket(admin, client.company.id, { siteId: client.site.id });
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "qualified" });
    await transitionTicket(admin, {
      ticketId: ticket.id,
      toStatus: "in_progress",
      assigneeMemberId: admin.member.id,
    });
    await logTicketTime(admin, {
      ticketId: ticket.id,
      minutes: 45,
      workOn: today(),
      billable: true,
      note: "Diagnostic",
    });
    await logTicketTime(admin, {
      ticketId: ticket.id,
      minutes: 30,
      workOn: today(),
      billable: false,
      note: "Correction",
    });
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "resolved" });
    return { ...client, ticket };
  }

  const interventionsOf = (ticketId: string) =>
    db
      .select()
      .from(s.maintenanceInterventions)
      .where(eq(s.maintenanceInterventions.ticketId, ticketId));

  it("saisit le temps par le module Temps, catégorie support, au coût figé", async () => {
    const { ticket, company, contract } = await resolvedCovered();
    const rows = await db.select().from(s.timeEntries).where(eq(s.timeEntries.ticketId, ticket.id));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      category: "support",
      companyId: company.id,
      contractId: contract.id,
      memberId: admin.member.id,
      hourlyCostCents: admin.member.hourlyCostCents,
    });
    const time = await getTicketTime(admin, ticket.id);
    expect(time.totalMinutes).toBe(75);
    expect(time.entries).toHaveLength(2);
    expect(JSON.stringify(time)).not.toContain("hourlyCost");
  });

  it("impute les heures au forfait à la clôture, une seule fois", async () => {
    const { ticket, contract } = await resolvedCovered();
    const input = { ticketId: ticket.id, toStatus: "closed" as const, note: "Vérifié" };
    await transitionTicket(admin, input);
    await transitionTicket(admin, input);
    expect(vi.mocked(consumeContractQuota)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(consumeContractQuota).mock.calls[0]?.[1]).toMatchObject({
      contractId: contract.id,
      minutes: 75,
      ticketId: ticket.id,
    });
    const interventions = await interventionsOf(ticket.id);
    expect(interventions).toHaveLength(1);
    expect(interventions[0]?.minutes).toBe(75);
  });

  it("une panne du forfait annule toute la clôture", async () => {
    const { ticket } = await resolvedCovered();
    const eventsBefore = (await eventsOf(ticket.id)).length;
    vi.mocked(consumeContractQuota).mockRejectedValueOnce(new Error("Base indisponible"));
    await expect(
      transitionTicket(admin, { ticketId: ticket.id, toStatus: "closed", note: "Vérifié" }),
    ).rejects.toThrow("Base indisponible");
    const current = await reload(ticket.id);
    expect(current.status).toBe("resolved");
    expect(current.closedAt).toBeNull();
    expect(await eventsOf(ticket.id)).toHaveLength(eventsBefore);
    expect(await domainEventsOf(ticket.id, "ticket.closed")).toHaveLength(0);

    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "closed", note: "Vérifié" });
    expect((await reload(ticket.id)).status).toBe("closed");
  });

  it("sans temps saisi ou non couverte, rien n'est imputé", async () => {
    const free = await createCompany(db);
    const uncovered = await newTicket(admin, free.id);
    await advance(admin, uncovered.id, "resolved");
    await transitionTicket(admin, { ticketId: uncovered.id, toStatus: "closed", note: "Vu" });

    const client = await coveredClient();
    const idle = await newTicket(admin, client.company.id, { siteId: client.site.id });
    await advance(admin, idle.id, "resolved");
    await transitionTicket(admin, { ticketId: idle.id, toStatus: "closed", note: "Vu" });
    expect(vi.mocked(consumeContractQuota)).not.toHaveBeenCalled();
  });

  it("un contrat résilié entre-temps n'empêche pas de clôturer, l'écart reste écrit", async () => {
    const { ticket, contract } = await resolvedCovered();
    await db
      .update(s.contracts)
      .set({ status: "terminated" })
      .where(eq(s.contracts.id, contract.id));
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "closed", note: "Vérifié" });
    expect(vi.mocked(consumeContractQuota)).not.toHaveBeenCalled();
    expect((await eventsOf(ticket.id)).at(-1)?.note).toContain("Temps non imputé");
  });
});

describe("messages, commentaires et fichiers", () => {
  it("un double envoi de message n'en crée qu'un", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    const input = { ticketId: ticket.id, body: "Bonjour", internal: false };
    const first = await addTicketMessage(admin, input);
    const second = await addTicketMessage(admin, input);
    expect(second.id).toBe(first.id);
    const detail = await getTicketDetail(admin, ticket.id);
    expect(detail.messages).toHaveLength(1);
    expect(await auditsOf(first.id, "ticket.replied")).toHaveLength(1);
  });

  it("commente par le service partagé, mentions comprises", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    const mentioned = await createMemberContext(db, "member");
    await addTicketComment(admin, {
      ticketId: ticket.id,
      body: "Peux-tu regarder ?",
      mentions: [mentioned.actor.userId],
    });
    const comments = await getTicketComments(admin, ticket.id);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      body: "Peux-tu regarder ?",
      mentions: [mentioned.actor.userId],
    });
  });

  it("lit les pièces jointes par le service Documents", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    const [document] = await db
      .insert(s.documents)
      .values({ title: "Capture", companyId: company.id, ticketId: ticket.id })
      .returning();
    const attachments = await getTicketAttachments(admin, ticket.id);
    expect(attachments.map((row) => row.id)).toEqual([document?.id]);
  });
});

describe("droits et périmètre", () => {
  it("lecture seule : voit tout, n'écrit rien", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    expect((await getTicketDetail(viewer, ticket.id)).ticket.id).toBe(ticket.id);
    await expect(newTicket(viewer, company.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      transitionTicket(viewer, { ticketId: ticket.id, toStatus: "qualified" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      assignTicket(viewer, { ticketId: ticket.id, assigneeMemberId: admin.member.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      addTicketMessage(viewer, { ticketId: ticket.id, body: "Non", internal: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      addTicketComment(viewer, { ticketId: ticket.id, body: "Non" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(archiveTicket(viewer, ticket.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      convertTicket(viewer, { ticketId: ticket.id, target: "quote" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un collaborateur travaille sur toutes les demandes", async () => {
    const member = await createMemberContext(db, "member");
    const company = await createCompany(db);
    const ticket = await newTicket(member, company.id);
    expect(
      (await transitionTicket(member, { ticketId: ticket.id, toStatus: "qualified" })).status,
    ).toBe("qualified");
  });

  it("un client n'entre par aucun service interne", async () => {
    const client = await createTestContext(db, "client");
    const company = await createCompany(db);
    await expect(getSupportBoard(client, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listTickets(client, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(newTicket(client, company.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  describe("prestataire", () => {
    let contractor: ServiceContext & { member: s.TeamMember };
    let mine: s.Ticket;
    let other: s.Ticket;

    beforeAll(async () => {
      contractor = await createMemberContext(db, "contractor");
      const company = await createCompany(db);
      mine = await newTicket(admin, company.id, { assigneeMemberId: contractor.member.id });
      other = await newTicket(admin, company.id, { assigneeMemberId: admin.member.id });
    });

    it("ne voit que ses demandes, dans le tableau, la liste et la fiche client", async () => {
      const board = await getSupportBoard(contractor, {});
      const ids = board.flatMap((column) => column.items.map((row) => row.id));
      expect(ids).toEqual([mine.id]);
      expect((await listTickets(contractor, {})).items.map((row) => row.id)).toEqual([mine.id]);
      expect(await listTicketsForCompany(contractor, mine.companyId)).toHaveLength(1);
      const summary = await getSupportOverview(contractor);
      expect(summary.open).toBe(1);
    });

    it("reçoit un 404 sur la demande d'un autre, même en la visant directement", async () => {
      expect((await getTicketDetail(contractor, mine.id)).ticket.id).toBe(mine.id);
      await expect(getTicketDetail(contractor, other.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(getTicketTime(contractor, other.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        logTicketTime(contractor, {
          ticketId: other.id,
          minutes: 10,
          workOn: parisDay(new Date()),
          billable: true,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        addTicketComment(contractor, { ticketId: other.id, body: "Non" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("sans fiche d'équipe : rien du tout", async () => {
      const orphan = await createTestContext(db, "contractor");
      expect((await listTickets(orphan, {})).total).toBe(0);
      await expect(getTicketDetail(orphan, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("ne change pas l'état, mais saisit son temps et commente ce qui lui est attribué", async () => {
      await expect(
        transitionTicket(contractor, { ticketId: mine.id, toStatus: "qualified" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await logTicketTime(contractor, {
        ticketId: mine.id,
        minutes: 20,
        workOn: parisDay(new Date()),
        billable: true,
      });
      await addTicketComment(contractor, { ticketId: mine.id, body: "Je m'en occupe" });
      expect(await getTicketComments(contractor, mine.id)).toHaveLength(1);
    });

    it("ne voit que son propre temps sur sa demande", async () => {
      await logTicketTime(admin, {
        ticketId: mine.id,
        minutes: 15,
        workOn: parisDay(new Date()),
        billable: true,
        note: "Temps de l'associé",
      });
      const time = await getTicketTime(contractor, mine.id);
      expect(time.totalMinutes).toBe(20);
      expect(time.entries.map((entry) => entry.note)).not.toContain("Temps de l'associé");
      expect((await getTicketTime(admin, mine.id)).totalMinutes).toBe(35);
    });

    it("n'a pas accès à la récurrence", async () => {
      await expect(getTicketRecurrence(contractor, { days: 30 })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });
});

describe("transformation en prestation", () => {
  async function outOfContract() {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id, { description: "Hors périmètre" });
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "qualified" });
    return ticket;
  }

  it("refuse une demande couverte", async () => {
    const { company, site } = await coveredClient();
    const ticket = await newTicket(admin, company.id, { siteId: site.id });
    await transitionTicket(admin, { ticketId: ticket.id, toStatus: "qualified" });
    await expect(
      convertTicket(admin, { ticketId: ticket.id, target: "change_request" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("crée la demande de changement et garde le lien, sans doublon", async () => {
    const ticket = await outOfContract();
    const link = await convertTicket(admin, { ticketId: ticket.id, target: "change_request" });
    expect(link).toMatchObject({ title: ticket.subject, status: "open", quoteId: null });
    expect((await reload(ticket.id)).changeRequestId).toBe(link.id);
    const [row] = await db.select().from(s.changeRequests).where(eq(s.changeRequests.id, link.id));
    expect(row).toMatchObject({ ticketId: ticket.id, companyId: ticket.companyId });

    const again = await convertTicket(admin, { ticketId: ticket.id, target: "change_request" });
    expect(again.id).toBe(link.id);
    const rows = await db
      .select()
      .from(s.changeRequests)
      .where(eq(s.changeRequests.ticketId, ticket.id));
    expect(rows).toHaveLength(1);
  });

  it("crée le devis en un clic, à partir de la demande existante ou sans elle, sans doublon", async () => {
    const direct = await outOfContract();
    const link = await convertTicket(admin, { ticketId: direct.id, target: "quote" });
    expect(link.status).toBe("converted");
    expect(link.quoteNumber).toMatch(/^D-\d{4}-/);
    const again = await convertTicket(admin, { ticketId: direct.id, target: "quote" });
    expect(again.quoteId).toBe(link.quoteId);
    const quotes = await db.select().from(s.quotes).where(eq(s.quotes.companyId, direct.companyId));
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ status: "draft" });

    const step = await outOfContract();
    const first = await convertTicket(admin, { ticketId: step.id, target: "change_request" });
    const second = await convertTicket(admin, { ticketId: step.id, target: "quote" });
    expect(second.id).toBe(first.id);
    expect(second.quoteId).not.toBeNull();
  });
});

describe("incidents", () => {
  it("ouvre un incident critique sur le client du site, sans acteur", async () => {
    const { company, site, contract } = await coveredClient();
    const ticket = await db.transaction((tx) =>
      openIncidentTicket(tx, { siteId: site.id, title: "Site injoignable", source: "uptime_kuma" }),
    );
    expect(ticket).toMatchObject({
      companyId: company.id,
      siteId: site.id,
      contractId: contract.id,
      isIncident: true,
      severity: "critical",
      channel: "monitoring",
      category: "incident",
      status: "received",
      openedByUserId: null,
    });
    expect(ticket.dueAt).not.toBeNull();
    expect(await domainEventsOf(ticket.id, "ticket.created")).toHaveLength(1);
    expect(await domainEventsOf(ticket.id, "ticket.critical")).toHaveLength(1);
  });

  it("une panne qui se répète renvoie le ticket ouvert, puis en rouvre un après résolution", async () => {
    const { site } = await coveredClient();
    const input = { siteId: site.id, title: "Site injoignable", source: "coolify" };
    const first = await openIncidentTicket(db, input);
    const repeat = await openIncidentTicket(db, { ...input, title: "Encore" });
    expect(repeat.id).toBe(first.id);
    expect(await domainEventsOf(first.id, "ticket.created")).toHaveLength(1);

    await advance(admin, first.id, "resolved");
    const next = await openIncidentTicket(db, input);
    expect(next.id).not.toBe(first.id);
  });

  it("deux alertes simultanées ne créent qu'un ticket", async () => {
    const { site } = await coveredClient();
    const input = { siteId: site.id, title: "Site injoignable", source: "uptime_kuma" };
    const [one, two] = await Promise.all([
      openIncidentTicket(db, input),
      openIncidentTicket(db, input),
    ]);
    expect(one?.id).toBe(two?.id);
    const rows = await db
      .select()
      .from(s.tickets)
      .where(and(eq(s.tickets.siteId, site.id), eq(s.tickets.isIncident, true)));
    expect(rows).toHaveLength(1);
  });

  it("refuse un site inconnu", async () => {
    await expect(
      openIncidentTicket(db, {
        siteId: "00000000-0000-4000-8000-000000000000",
        title: "Panne",
        source: "uptime_kuma",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("identifiants invalides", () => {
  it("répond 404 plutôt qu'une erreur SQL", async () => {
    await expect(getTicketDetail(admin, "pas-un-identifiant")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const portal = await createPortalTestContext(db);
    await expect(getTicketForPortal(portal, "pas-un-identifiant")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("portail client", () => {
  it("crée la demande sur l'entreprise du client, canal portail, sans doublon", async () => {
    const portal = await createPortalTestContext(db);
    const input = { subject: subject(), description: "Un souci", category: "bug" as const };
    const created = await createTicketFromPortal(portal, input);
    const again = await createTicketFromPortal(portal, input);
    expect(again.id).toBe(created.id);
    const row = await reload(created.id);
    expect(row).toMatchObject({
      companyId: portal.companyId,
      channel: "portal",
      category: "bug",
      severity: "medium",
      openedByUserId: portal.actor.userId,
    });
    expect(await auditsOf(created.id, "portal.ticket_opened")).toHaveLength(1);
    expect(await domainEventsOf(created.id, "ticket.created")).toHaveLength(1);
  });

  it("refuse le site d'un autre client comme s'il n'existait pas", async () => {
    const portal = await createPortalTestContext(db);
    const { site } = await coveredClient();
    await expect(
      createTicketFromPortal(portal, { subject: subject(), siteId: site.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("n'expose que l'entreprise du client et cache l'interne", async () => {
    const portal = await createPortalTestContext(db);
    const stranger = await createPortalTestContext(db);
    const assignee = await createMemberContext(db, "member", { fullName: "Responsable Secret" });
    const created = await createTicketFromPortal(portal, { subject: subject() });
    await assignTicket(admin, { ticketId: created.id, assigneeMemberId: assignee.member.id });
    await addTicketMessage(admin, {
      ticketId: created.id,
      body: "Réponse visible",
      internal: false,
    });
    await addTicketMessage(admin, {
      ticketId: created.id,
      body: "Note secrète",
      internal: true,
    });
    await transitionTicket(admin, {
      ticketId: created.id,
      toStatus: "qualified",
      note: "Note de qualification interne",
    });

    const list = await listTicketsForPortal(portal);
    expect(list.map((row) => row.id)).toEqual([created.id]);
    expect(await listTicketsForPortal(stranger)).toHaveLength(0);

    const detail = await getTicketForPortal(portal, created.id);
    expect(detail.messages.map((message) => message.body)).toEqual(["Réponse visible"]);
    expect(detail.messages[0]?.fromClient).toBe(false);
    expect(detail.timeline.map((step) => step.status)).toEqual(["received", "qualified"]);

    const serialized = JSON.stringify({ list, detail });
    for (const secret of [
      "Note secrète",
      "Note de qualification interne",
      "Responsable Secret",
      "coverage",
      "contractId",
      "assignee",
    ]) {
      expect(serialized).not.toContain(secret);
    }

    await expect(getTicketForPortal(stranger, created.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("le client répond sur sa demande, ni sur celle d'un autre ni sur une clôturée", async () => {
    const portal = await createPortalTestContext(db);
    const stranger = await createPortalTestContext(db);
    const created = await createTicketFromPortal(portal, { subject: subject() });
    const message = await addPortalTicketMessage(portal, {
      ticketId: created.id,
      body: "Voici une précision",
    });
    expect(message.fromClient).toBe(true);
    const repeated = await addPortalTicketMessage(portal, {
      ticketId: created.id,
      body: "Voici une précision",
    });
    expect(repeated.id).toBe(message.id);
    // La réponse du client n'arrête pas le délai de première réponse de l'agence.
    expect((await reload(created.id)).firstResponseAt).toBeNull();
    const seen = await getTicketDetail(admin, created.id);
    expect(seen.messages.map((row) => row.body)).toContain("Voici une précision");

    await expect(
      addPortalTicketMessage(stranger, { ticketId: created.id, body: "Intrusion" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await advance(admin, created.id, "resolved");
    await transitionTicket(admin, { ticketId: created.id, toStatus: "closed", note: "Vu" });
    await expect(
      addPortalTicketMessage(portal, { ticketId: created.id, body: "Trop tard" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("listes, résumés et archivage", () => {
  it("filtre, cherche, pagine et trie côté serveur", async () => {
    const company = await createCompany(db, { name: "Client Filtrage Unique" });
    for (let index = 0; index < 30; index += 1) {
      await insertRawTicket(db, {
        companyId: company.id,
        subject: `Filtrage ${index}`,
        severity: index === 0 ? "critical" : "low",
      });
    }
    const page1 = await listTickets(admin, { client: company.id });
    expect(page1.total).toBe(30);
    expect(page1.items).toHaveLength(25);
    const page2 = await listTickets(admin, { client: company.id, page: "2" });
    expect(page2.items).toHaveLength(5);
    expect(new Set([...page1.items, ...page2.items].map((row) => row.id)).size).toBe(30);

    const searched = await listTickets(admin, { q: "Client Filtrage Unique" });
    expect(searched.total).toBe(30);
    const percent = await listTickets(admin, { q: "%" });
    expect(percent.total).toBe(0);

    const critical = await listTickets(admin, { client: company.id, filtre: "critiques" });
    expect(critical.total).toBe(1);
    const sorted = await listTickets(admin, { client: company.id, tri: "gravite", sens: "desc" });
    expect(sorted.items[0]?.severity).toBe("critical");

    // Une valeur inconnue dans l'URL est ignorée, jamais une erreur.
    const lenient = await listTickets(admin, { client: company.id, statut: "n-importe-quoi" });
    expect(lenient.total).toBe(30);
  });

  it("borne chaque colonne du tableau et donne le vrai total", async () => {
    const company = await createCompany(db);
    for (let index = 0; index < 45; index += 1) {
      await insertRawTicket(db, { companyId: company.id, subject: `Colonne ${index}` });
    }
    const board = await getSupportBoard(admin, { client: company.id });
    const received = board.find((column) => column.status === "received");
    expect(received?.total).toBe(45);
    expect(received?.items).toHaveLength(40);
    expect(board.map((column) => column.status)).toEqual(TICKET_STATUSES);
  });

  it("met les plus graves en tête de colonne", async () => {
    const company = await createCompany(db);
    await insertRawTicket(db, { companyId: company.id, severity: "low", subject: "Faible" });
    await insertRawTicket(db, { companyId: company.id, severity: "critical", subject: "Critique" });
    await insertRawTicket(db, { companyId: company.id, severity: "high", subject: "Haute" });
    const board = await getSupportBoard(admin, { client: company.id });
    expect(board[0]?.items.map((row) => row.subject)).toEqual(["Critique", "Haute", "Faible"]);
  });

  it("le résumé compte les ouvertes, les retards et le délai moyen de réponse", async () => {
    const before = await getSupportSummary(db);
    const company = await createCompany(db);
    const now = new Date();
    await insertRawTicket(db, {
      companyId: company.id,
      status: "in_progress",
      severity: "critical",
      dueAt: new Date(now.getTime() - HOUR),
    });
    await insertRawTicket(db, {
      companyId: company.id,
      status: "received",
      createdAt: new Date(now.getTime() - 2 * HOUR),
      firstResponseAt: new Date(now.getTime() - HOUR),
    });
    const after = await getSupportSummary(db);
    expect(after.open).toBe(before.open + 2);
    expect(after.overdue).toBe(before.overdue + 1);
    expect(after.critical).toBe(before.critical + 1);
    expect(after.unassigned).toBe(before.unassigned + 2);
    expect(after.avgFirstResponseMinutes).not.toBeNull();
  });

  it("la fiche client reçoit des lignes compactes, bornées", async () => {
    const company = await createCompany(db);
    const ticket = await newTicket(admin, company.id);
    await newTicket(admin, company.id);
    const rows = await listTicketsForCompany(admin, company.id, { limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ href: expect.stringContaining("/support/") });
    const all = await listTicketsForCompany(viewer, company.id);
    expect(all.map((row) => row.id)).toContain(ticket.id);
  });

  it("la récurrence classe les clients et les sites les plus demandeurs", async () => {
    const big = await coveredClient();
    const old = await coveredClient();
    for (let index = 0; index < 7; index += 1) {
      await insertRawTicket(db, {
        companyId: big.company.id,
        siteId: big.site.id,
        coverage: index === 0 ? "not_covered" : "covered",
      });
    }
    for (let index = 0; index < 50; index += 1) {
      await insertRawTicket(db, {
        companyId: old.company.id,
        siteId: old.site.id,
        createdAt: new Date(Date.now() - 200 * 24 * HOUR),
      });
    }
    const recent = await getTicketRecurrence(viewer, { days: 30 });
    const ids = recent.companies.map((row) => row.id);
    expect(ids).toContain(big.company.id);
    expect(ids).not.toContain(old.company.id);
    const row = recent.companies.find((company) => company.id === big.company.id);
    expect(row).toMatchObject({ total: 7, notCovered: 1 });
    expect(recent.sites.find((site) => site.id === big.site.id)?.total).toBe(7);
    const year = await getTicketRecurrence(viewer, { days: 365 });
    expect(year.companies.map((company) => company.id)).toContain(old.company.id);
  });

  it("l'archivage retire la demande des listes, la garde en base, et libère l'incident", async () => {
    const { site } = await coveredClient();
    const incident = await openIncidentTicket(db, {
      siteId: site.id,
      title: "Panne",
      source: "uptime_kuma",
    });
    await archiveTicket(admin, incident.id);
    expect((await reload(incident.id)).archivedAt).not.toBeNull();
    await expect(getTicketDetail(admin, incident.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await auditsOf(incident.id, "ticket.archived")).toHaveLength(1);
    const next = await openIncidentTicket(db, {
      siteId: site.id,
      title: "Panne",
      source: "uptime_kuma",
    });
    expect(next.id).not.toBe(incident.id);
  });
});

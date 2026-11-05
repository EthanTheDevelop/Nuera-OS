import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { unconfiguredN8nGateway, type N8nGateway } from "@/integrations/n8n/n8n.client";
import { addPortalTicketMessage } from "@/modules/support/ticket.service";
import {
  dispatchPendingEvents,
  getAutomationsSummary,
  listAutomationRules,
  listAutomationRuns,
  MAX_AUTOMATIC_ATTEMPTS,
  retryAutomationRun,
  retryFailedAutomationRuns,
  setAutomationRuleEnabled,
} from "@/modules/platform/automation.service";
import { AUTOMATION_RULES } from "@/modules/platform/automation.rules";
import { DOMAIN_EVENT_TYPES, emitEvent } from "@/modules/platform/events";
import * as schema from "@/server/db/schema";
import {
  automationRuns,
  conversations,
  domainEvents,
  emailOutbox,
  messages,
  notifications,
  portalPreferences,
  replySuggestions,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { createTestActor, createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createPortalClient,
  createPortalTestContext,
  createProject,
  createTeamMember,
  createTicket,
} from "../../helpers/factories";

let db: Database;

beforeEach(async () => {
  ({ db } = await createTestDatabase());
});

const noN8n: N8nGateway = unconfiguredN8nGateway;

const deps = { n8n: noN8n };

async function emitSiteDown(entityId: string = crypto.randomUUID()) {
  await emitEvent(db, {
    type: "site.down",
    entityType: "site",
    entityId,
    companyId: null,
    actorId: null,
    payload: { name: "Site", primaryDomain: "exemple.test", source: "uptime_kuma" },
  });
  return entityId;
}

const notificationsOf = (userId: string) =>
  db.select().from(notifications).where(eq(notifications.userId, userId));

describe("catalogue", () => {
  it("couvre les événements exigés, sans clé dupliquée", () => {
    const covered = new Set(AUTOMATION_RULES.flatMap((rule) => rule.events));
    for (const type of [
      "message.received",
      "opportunity.won",
      "quote.accepted",
      "deliverable.submitted",
      "deliverable.validated",
      "deliverable.changes_requested",
      "task.overdue",
      "budget.threshold_80",
      "contract.expiring",
      "contract.quota_80",
      "contract.quota_exceeded",
      "ticket.created",
      "ticket.critical",
      "site.down",
      "backup.failed",
      "domain.expiring",
      "invoice.overdue",
      "ticket.client_message",
    ] as const) {
      expect(covered.has(type)).toBe(true);
    }
    for (const type of covered) expect(DOMAIN_EVENT_TYPES).toContain(type);
    const keys = AUTOMATION_RULES.map((rule) => rule.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("dispatchPendingEvents", () => {
  it("notifie avec un lien vers l'objet, puis marque l'événement distribué", async () => {
    const admin = await createTestActor(db, "admin");
    const member = await createTestActor(db, "member");
    const viewer = await createTestActor(db, "viewer");
    const siteId = await emitSiteDown();

    const result = await dispatchPendingEvents(db, { deps });
    expect(result).toMatchObject({ events: 1, succeeded: 1, failed: 0 });

    for (const id of [admin.userId, member.userId]) {
      const [row] = await notificationsOf(id);
      expect(row?.href).toBe(`/sites/${siteId}`);
      expect(row?.severity).toBe("danger");
    }
    expect(await notificationsOf(viewer.userId)).toHaveLength(0);
    const events = await db.select().from(domainEvents);
    expect(events.every((event) => event.dispatchedAt !== null)).toBe(true);
  });

  it("n'agit jamais deux fois : relance, et deux lancements simultanés", async () => {
    const admin = await createTestActor(db, "admin");
    await emitSiteDown();
    await Promise.all([dispatchPendingEvents(db, { deps }), dispatchPendingEvents(db, { deps })]);
    await dispatchPendingEvents(db, { deps });
    expect(await notificationsOf(admin.userId)).toHaveLength(1);
    expect(await db.select().from(automationRuns)).toHaveLength(1);
  });

  it("une règle désactivée n'agit pas, et ne rattrape pas ce qu'elle a laissé passer", async () => {
    const ctx = await createTestContext(db, "admin");
    await setAutomationRuleEnabled(ctx, { key: "site_down", enabled: false });
    await emitSiteDown();
    await dispatchPendingEvents(db, { deps });
    expect(await notificationsOf(ctx.actor.userId)).toHaveLength(0);
    expect(await db.select().from(automationRuns)).toHaveLength(0);

    await setAutomationRuleEnabled(ctx, { key: "site_down", enabled: true });
    await dispatchPendingEvents(db, { deps });
    expect(await notificationsOf(ctx.actor.userId)).toHaveLength(0);
  });

  it("n'exclut que l'auteur de l'action", async () => {
    const author = await createTestActor(db, "admin");
    const other = await createTestActor(db, "admin");
    await emitEvent(db, {
      type: "opportunity.won",
      entityType: "opportunity",
      entityId: crypto.randomUUID(),
      companyId: null,
      actorId: author.userId,
      payload: { amountCents: 1000 },
    });
    await dispatchPendingEvents(db, { deps });
    expect(await notificationsOf(author.userId)).toHaveLength(0);
    expect(await notificationsOf(other.userId)).toHaveLength(1);
  });

  it("ne donne aucune alerte de facture à un rôle sans finance:read", async () => {
    const admin = await createTestActor(db, "admin");
    const member = await createTestActor(db, "member");
    await emitEvent(db, {
      type: "invoice.overdue",
      entityType: "financial_document",
      entityId: crypto.randomUUID(),
      companyId: null,
      actorId: null,
      payload: { externalRef: "F-1", amountCents: 100, dueOn: "2026-01-01" },
    });
    await dispatchPendingEvents(db, { deps });
    expect(await notificationsOf(admin.userId)).toHaveLength(1);
    expect(await notificationsOf(member.userId)).toHaveLength(0);
  });
});

describe("échecs et relance sans doublon", () => {
  async function failingN8nRun() {
    const ctx = await createTestContext(db, "admin");
    await setAutomationRuleEnabled(ctx, { key: "n8n_forward", enabled: true });
    await setAutomationRuleEnabled(ctx, { key: "quote_accepted", enabled: false });
    await emitEvent(db, {
      type: "quote.accepted",
      entityType: "quote",
      entityId: crypto.randomUUID(),
      companyId: null,
      actorId: null,
      payload: { number: "D-1", versionId: "v", opportunityId: null, totalCents: 100 },
    });
    return ctx;
  }

  it("trace l'échec, sans succès simulé, et garde l'événement à relancer", async () => {
    await failingN8nRun();
    const result = await dispatchPendingEvents(db, { deps });
    expect(result).toMatchObject({ failed: 1, retained: 1 });
    const [run] = await db.select().from(automationRuns);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("Connexion requise");
    const [event] = await db.select().from(domainEvents);
    expect(event?.dispatchedAt).toBeNull();
  });

  it("retente un nombre borné de fois, avec attente, puis sort de la file", async () => {
    await failingN8nRun();
    const start = new Date();
    await dispatchPendingEvents(db, { deps, now: start });

    // Sans attente, aucune nouvelle tentative.
    await dispatchPendingEvents(db, { deps, now: new Date(start.getTime() + 1000) });
    expect((await db.select().from(automationRuns))[0]?.attempts).toBe(1);

    // `finished_at` vaut l'heure réelle : on simule le passage du temps par des dates futures.
    let hours = 24 * 365 * 10;
    for (let attempt = 0; attempt < MAX_AUTOMATIC_ATTEMPTS + 2; attempt += 1) {
      hours += 24;
      await dispatchPendingEvents(db, {
        deps,
        now: new Date(Date.now() + hours * 3_600_000),
      });
    }
    const [run] = await db.select().from(automationRuns);
    expect(run?.status).toBe("failed");
    expect(run?.attempts).toBe(MAX_AUTOMATIC_ATTEMPTS);
    const [event] = await db.select().from(domainEvents);
    expect(event?.dispatchedAt).not.toBeNull();
  });

  it("relance à la main, sans doublon, quand le service revient", async () => {
    const ctx = await failingN8nRun();
    await dispatchPendingEvents(db, { deps });
    const [run] = await db.select().from(automationRuns);
    if (!run) throw new Error("Exécution absente");

    const sent: string[] = [];
    const n8n: N8nGateway = {
      isConfigured: true,
      send: async (event) => {
        sent.push(event.id);
      },
    };
    expect(await retryAutomationRun(ctx, run.id, { deps: { n8n } })).toBe("succeeded");
    expect(sent).toHaveLength(1);

    const rows = await db.select().from(automationRuns);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("succeeded");
    const [event] = await db.select().from(domainEvents);
    expect(event?.dispatchedAt).not.toBeNull();

    // Plus rien à relancer.
    await expect(retryAutomationRun(ctx, run.id, { deps: { n8n } })).rejects.toThrow();
    expect((await retryFailedAutomationRuns(ctx, { deps: { n8n } })).retried).toBe(0);
    await dispatchPendingEvents(db, { deps: { n8n } });
    expect(sent).toHaveLength(1);
  });

  it("une écriture annulée ne laisse rien : la relance ne double pas les notifications", async () => {
    const ctx = await createTestContext(db, "admin");
    await emitSiteDown();
    await dispatchPendingEvents(db, { deps });
    const before = await notificationsOf(ctx.actor.userId);
    const [run] = await db.select().from(automationRuns);
    if (!run) throw new Error("Exécution absente");

    await db
      .update(automationRuns)
      .set({ status: "failed", error: "panne" })
      .where(eq(automationRuns.id, run.id));
    expect(await retryAutomationRun(ctx, run.id, { deps })).toBe("succeeded");
    expect(await notificationsOf(ctx.actor.userId)).toHaveLength(before.length);
  });

  it("réserve l'activation et la relance à automations:manage", async () => {
    const member = await createTestContext(db, "member");
    const viewer = await createTestContext(db, "viewer");
    await expect(
      setAutomationRuleEnabled(member, { key: "site_down", enabled: false }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(retryAutomationRun(member, crypto.randomUUID())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listAutomationRules(viewer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAutomationRuns(viewer)).rejects.toBeInstanceOf(ForbiddenError);
    const admin = await createTestContext(db, "admin");
    await expect(
      setAutomationRuleEnabled(admin, { key: "inconnue", enabled: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("règles", () => {
  async function inboundMessage() {
    const company = await createCompany(db);
    const [conversation] = await db
      .insert(conversations)
      .values({ companyId: company.id, subject: "Sujet" })
      .returning();
    if (!conversation) throw new Error("Conversation absente");
    const [message] = await db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        companyId: company.id,
        direction: "inbound",
        body: "Bonjour, où en est le site ?",
      })
      .returning();
    if (!message) throw new Error("Message absent");
    await emitEvent(db, {
      type: "message.received",
      entityType: "message",
      entityId: message.id,
      companyId: company.id,
      actorId: null,
      payload: { conversationId: conversation.id, direction: "inbound" },
    });
    return { conversation, message };
  }

  it("message reçu : prépare la suggestion, sans envoi, puis prévient l'équipe", async () => {
    const member = await createTestActor(db, "member");
    const { conversation } = await inboundMessage();
    const generator = {
      isConfigured: true,
      generate: async () => ({ text: "Proposition", model: "test" }),
    };
    await dispatchPendingEvents(db, { deps: { ...deps, suggestion: { generator } } });
    const suggestions = await db.select().from(replySuggestions);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.status).toBe("ready");
    const allMessages = await db.select().from(messages);
    expect(allMessages).toHaveLength(1);
    const [row] = await notificationsOf(member.userId);
    expect(row?.href).toBe(`/messages/${conversation.id}`);
    expect(row?.kind).toBe("client_message");
  });

  it("OpenAI en panne : l'équipe est quand même prévenue", async () => {
    const member = await createTestActor(db, "member");
    await inboundMessage();
    const generator = {
      isConfigured: true,
      generate: () => Promise.reject(new Error("panne")),
    };
    const result = await dispatchPendingEvents(db, {
      deps: { ...deps, suggestion: { generator } },
    });
    expect(result.succeeded).toBe(1);
    expect(await notificationsOf(member.userId)).toHaveLength(1);
  });

  it("une réponse d'un client sur une demande prévient l'agence, une seule fois", async () => {
    const agent = await createTestActor(db, "member");
    const portal = await createPortalTestContext(db);
    const ticket = await createTicket(db, { companyId: portal.companyId });
    await addPortalTicketMessage(portal, { ticketId: ticket.id, body: "Un retour" });
    await addPortalTicketMessage(portal, { ticketId: ticket.id, body: "Un retour" });
    await dispatchPendingEvents(db, { deps });
    const rows = (await notificationsOf(agent.userId)).filter(
      (row) => row.entityId === ticket.id && row.kind === "client_message",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.href).toBe(`/support/${ticket.id}`);
  });

  it("livrable soumis : l'e-mail au client respecte ses préférences", async () => {
    const company = await createCompany(db, { status: "client" });
    const accepted = await createPortalClient(db, { company });
    const refused = await createPortalClient(db, { company });
    const other = await createPortalClient(db);
    await db
      .insert(portalPreferences)
      .values({ userId: refused.actor.userId, notifyValidation: false });
    const project = await createProject(db, { companyId: company.id });
    await emitEvent(db, {
      type: "deliverable.submitted",
      entityType: "deliverable",
      entityId: crypto.randomUUID(),
      companyId: company.id,
      actorId: null,
      payload: { projectId: project.id, title: "Maquette", version: 1 },
    });
    await dispatchPendingEvents(db, { deps });
    await dispatchPendingEvents(db, { deps });
    const mails = await db.select().from(emailOutbox);
    expect(mails.map((mail) => mail.toAddress)).toEqual([accepted.actor.email]);
    expect(mails.some((mail) => mail.toAddress === other.actor.email)).toBe(false);
  });

  it("tâche en retard : prévient la personne assignée et le responsable", async () => {
    const assignee = await createTestActor(db, "contractor");
    const owner = await createTestActor(db, "member");
    const assigneeMember = await createTeamMember(db, {
      kind: "contractor",
      userId: assignee.userId,
    });
    const ownerMember = await createTeamMember(db, { userId: owner.userId });
    const project = await createProject(db, { ownerMemberId: ownerMember.id });
    const taskId = crypto.randomUUID();
    await emitEvent(db, {
      type: "task.overdue",
      entityType: "task",
      entityId: taskId,
      companyId: project.companyId,
      actorId: null,
      payload: {
        projectId: project.id,
        title: "Intégrer",
        dueOn: "2026-01-01",
        assigneeMemberId: assigneeMember.id,
      },
    });
    await dispatchPendingEvents(db, { deps });
    for (const id of [assignee.userId, owner.userId]) {
      expect((await notificationsOf(id))[0]?.href).toBe(`/projets/${project.id}?tache=${taskId}`);
    }
  });
});

describe("getAutomationsSummary et écran 12", () => {
  it("compte les vraies exécutions du mois", async () => {
    const ctx = await createTestContext(db, "admin");
    await emitSiteDown();
    await emitSiteDown();
    await dispatchPendingEvents(db, { deps });

    const summary = await getAutomationsSummary(db);
    expect(summary.runsThisMonth).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.rulesTotal).toBe(AUTOMATION_RULES.length);
    // Relais n8n désactivé par défaut.
    expect(summary.rulesEnabled).toBe(AUTOMATION_RULES.length - 1);

    const groups = await listAutomationRules(ctx);
    const rule = groups.flatMap((group) => group.rules).find((row) => row.key === "site_down");
    expect(rule?.runsThisMonth).toBe(2);
    expect((await listAutomationRuns(ctx, { pageSize: 1 })).total).toBe(2);
    expect(schema.automationRules).toBeDefined();
  });
});

import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { N8nGateway } from "@/integrations/n8n/n8n.client";
import { unconfiguredSmtpGateway, type SmtpGateway } from "@/integrations/smtp/smtp.client";
import { inviteUser, listAuditLog, listUsers } from "@/modules/admin/admin.service";
import {
  dispatchPendingEvents,
  listAutomationRuns,
  retryAutomationRun,
  retryFailedAutomationRuns,
  setAutomationRuleEnabled,
} from "@/modules/platform/automation.service";
import { listConnections, type ConnectionGateways } from "@/modules/platform/connections.service";
import { emitEvent } from "@/modules/platform/events";
import { runJob, type JobLock } from "@/modules/platform/jobs.service";
import { handleN8nWebhook } from "@/modules/platform/n8n.webhook";
import {
  absoluteAppUrl,
  listMyNotifications,
  notify,
  openNotification,
} from "@/modules/platform/notifications.service";
import { buildAuth, type Auth } from "@/server/auth/auth";
import {
  auditLog,
  automationRuns,
  domainEvents,
  emailOutbox,
  integrationConnections,
  notifications,
  users,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import { createCompany, createContact, createQuote } from "../../helpers/factories";

let db: Database;
let auth: Auth;

beforeEach(async () => {
  ({ db } = await createTestDatabase());
  auth = buildAuth({ db, secret: "s".repeat(32), baseURL: "http://localhost:3000" });
});

const free: JobLock = async (_name, run) => {
  await run();
  return true;
};
const failingN8n: N8nGateway = {
  isConfigured: true,
  send: () => Promise.reject(new Error("panne")),
};
const smtpUp: SmtpGateway = { ...unconfiguredSmtpGateway, isConfigured: true };

async function emitQuoteAccepted() {
  await emitEvent(db, {
    type: "quote.accepted",
    entityType: "quote",
    entityId: crypto.randomUUID(),
    companyId: null,
    actorId: null,
    payload: { number: "D-1", opportunityId: null } as never,
  });
}

describe("API d'administration de better-auth", () => {
  it.each([
    "set-role",
    "ban-user",
    "unban-user",
    "create-user",
    "set-user-password",
    "update-user",
    "revoke-user-sessions",
  ])("/admin/%s n'existe pas en HTTP : rien ne contourne journal et règles", async (path) => {
    const response = await auth.handler(
      new Request(`http://localhost:3000/api/auth/admin/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(404);
  });
});

describe("invitation", () => {
  it("un compte créé reste journalisé même si le lien échoue", async () => {
    const admin = await createTestContext(db, "admin");
    const broken = {
      ...auth,
      api: { ...auth.api, requestPasswordReset: async () => ({ status: true }) },
    } as unknown as Auth;
    const email = "sans-lien@exemple.test";
    await expect(
      inviteUser(
        admin,
        { name: "Sans Lien", email, role: "member" },
        { auth: broken, smtpConfigured: false },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    const [created] = await db.select().from(users).where(eq(users.email, email));
    expect(created).toBeDefined();
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, created?.id ?? ""), eq(auditLog.action, "user.created")));
    expect(audits).toHaveLength(1);
  });
});

describe("paramètres d'URL", () => {
  it("une page illisible retombe sur la première, sans faire tomber l'écran", async () => {
    const admin = await createTestContext(db, "admin");
    for (const page of ["abc", "0", "-1", ["1", "2"]]) {
      expect((await listUsers(admin, { page })).page).toBe(1);
      expect((await listAutomationRuns(admin, { page })).page).toBe(1);
      expect((await listAuditLog(admin, { page })).page).toBe(1);
      expect((await listMyNotifications(admin, { page })).page).toBe(1);
    }
  });

  it("une date impossible du journal est ignorée", async () => {
    const admin = await createTestContext(db, "admin");
    await expect(listAuditLog(admin, { from: "2026-99-99", to: "x" })).resolves.toMatchObject({
      page: 1,
    });
  });
});

describe("relance d'une règle désactivée", () => {
  async function failedRun() {
    const admin = await createTestContext(db, "admin");
    await setAutomationRuleEnabled(admin, { key: "n8n_forward", enabled: true });
    await emitQuoteAccepted();
    await dispatchPendingEvents(db, { deps: { n8n: failingN8n } });
    const [run] = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.ruleKey, "n8n_forward"));
    if (!run) throw new Error("Exécution absente");
    await setAutomationRuleEnabled(admin, { key: "n8n_forward", enabled: false });
    return { admin, run };
  }

  it("refuse la relance, individuelle et groupée, et ne propose pas le bouton", async () => {
    const { admin, run } = await failedRun();
    const sent: string[] = [];
    const n8n: N8nGateway = {
      isConfigured: true,
      send: async (event) => {
        sent.push(event.id);
      },
    };
    await expect(retryAutomationRun(admin, run.id, { deps: { n8n } })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await retryFailedAutomationRuns(admin, { deps: { n8n } })).toEqual({
      retried: 0,
      stillFailing: 0,
    });
    expect(sent).toHaveLength(0);

    const listed = await listAutomationRuns(admin, {});
    expect(listed.failed).toBe(0);
    expect(listed.failedTotal).toBe(1);
    expect(listed.items.find((row) => row.id === run.id)?.retryable).toBe(false);
  });
});

describe("relance d'une règle quand une autre attend sur le même événement", () => {
  it("l'événement reste en file : l'autre règle garde ses essais automatiques", async () => {
    const admin = await createTestContext(db, "admin");
    await setAutomationRuleEnabled(admin, { key: "n8n_forward", enabled: true });
    await emitQuoteAccepted();
    await dispatchPendingEvents(db, { deps: { n8n: failingN8n } });
    const [sibling] = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.ruleKey, "quote_accepted"));
    if (!sibling) throw new Error("Exécution absente");
    await db
      .update(automationRuns)
      .set({ status: "failed", error: "panne" })
      .where(eq(automationRuns.id, sibling.id));

    expect(await retryAutomationRun(admin, sibling.id, {})).toBe("succeeded");
    const [event] = await db.select().from(domainEvents);
    expect(event?.dispatchedAt).toBeNull();

    const sent: string[] = [];
    await dispatchPendingEvents(db, {
      now: new Date(Date.now() + 86_400_000),
      deps: {
        n8n: {
          isConfigured: true,
          send: async (payload) => {
            sent.push(payload.id);
          },
        },
      },
    });
    expect(sent).toHaveLength(1);
    expect((await db.select().from(domainEvents))[0]?.dispatchedAt).not.toBeNull();
  });
});

describe("liens internes", () => {
  const TRAP = "/\\exemple.test/phishing";

  it("/\\ est suivi par les navigateurs comme // : jamais un lien interne", async () => {
    const owner = await createTestContext(db, "member");
    await notify(db, {
      userIds: [owner.actor.userId],
      kind: "test",
      severity: "info",
      title: "Piège",
      href: TRAP,
      dedupeKey: "piege",
    });
    const [row] = await db.select().from(notifications);
    expect(await openNotification(owner, row?.id ?? "")).toEqual({ href: null });
    expect(absoluteAppUrl(TRAP)).toBeNull();
  });

  it("le webhook n8n refuse ce lien", async () => {
    expect(await handleN8nWebhook(db, { id: "x1", title: "T", href: TRAP })).toBe("invalid");
  });
});

describe("relance d'un devis", () => {
  async function dueQuote(firstName: string) {
    const company = await createCompany(db);
    await createContact(db, {
      companyId: company.id,
      email: "contact@exemple.test",
      firstName,
      isPrimary: true,
    });
    const sentAt = new Date(Date.now() - 10 * 86_400_000);
    return createQuote(db, { companyId: company.id, status: "sent", sentAt });
  }

  const reminders = () =>
    db.select().from(domainEvents).where(eq(domainEvents.type, "quote.reminder_due"));

  it("sans SMTP : la relance reste due, la tâche le dit, rien ne se prétend envoyé", async () => {
    await createTestContext(db, "admin");
    await dueQuote("Anne");
    const outcome = await runJob(db, "quotes-reminders", {
      lock: free,
      deps: { smtp: unconfiguredSmtpGateway },
    });
    expect(outcome.status).toBe("not_configured");
    expect(await reminders()).toHaveLength(0);

    // Le serveur d'envoi arrive : la relance part.
    const later = await runJob(db, "quotes-reminders", { lock: free, deps: { smtp: smtpUp } });
    expect(later.status).toBe("succeeded");
    expect(await reminders()).toHaveLength(1);
  });

  it("le contenu venant du CRM est échappé dans le HTML de l'e-mail", async () => {
    await createTestContext(db, "admin");
    await dueQuote('<img src=x onerror="a">');
    await runJob(db, "quotes-reminders", { lock: free, deps: { smtp: smtpUp } });
    await dispatchPendingEvents(db, { deps: { n8n: failingN8n } });
    const [mail] = await db.select().from(emailOutbox);
    expect(mail?.html).toBeTruthy();
    expect(mail?.html).not.toContain("<img");
    expect(mail?.html).toContain("&lt;img");
  });
});

describe("connexions", () => {
  it("Indy n'a aucun appel de vérification : aucune date de vérification affichée", async () => {
    const admin = await createTestContext(db, "admin");
    await db
      .insert(integrationConnections)
      .values({ service: "indy", status: "to_verify", lastCheckAt: new Date() });
    const gateways = {
      crm: { isConfigured: false },
      coolify: { isConfigured: false },
      uptimeKuma: { isConfigured: false },
      docuseal: { isConfigured: false },
      text: { isConfigured: false },
      smtp: { isConfigured: false },
      n8n: { isConfigured: false },
      calConfigured: false,
    } as unknown as ConnectionGateways;
    const views = await listConnections(admin, { gateways });
    expect(views.find((row) => row.service === "indy")?.lastCheckAt).toBeNull();
  });
});

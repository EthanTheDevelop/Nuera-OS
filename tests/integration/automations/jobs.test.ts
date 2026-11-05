import { eq, like } from "drizzle-orm";
import { Pool } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import { unconfiguredSmtpGateway } from "@/integrations/smtp/smtp.client";
import { dispatchPendingEvents } from "@/modules/platform/automation.service";
import { createAdvisoryJobLock } from "@/modules/platform/job-lock";
import {
  isJobName,
  JOBS,
  listJobRuns,
  runJob,
  type JobLock,
} from "@/modules/platform/jobs.service";
import {
  clientRequirements,
  domainEvents,
  domains,
  emailOutbox,
  notifications,
  quotes,
  syncRuns,
  userPreferences,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError } from "@/server/errors";
import { createTestActor, createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContact,
  createProject,
  createQuote,
  createTask,
} from "../../helpers/factories";

let db: Database;

beforeEach(async () => {
  ({ db } = await createTestDatabase());
});

const free: JobLock = async (_name, run) => {
  await run();
  return true;
};
const busy: JobLock = async () => false;

const eventsOfType = (type: string) =>
  db.select().from(domainEvents).where(eq(domainEvents.type, type));

describe("runJob", () => {
  it("trace une exécution réussie dans sync_runs", async () => {
    const outcome = await runJob(db, "events-dispatch", { lock: free });
    expect(outcome).toEqual({ status: "succeeded", items: 0 });
    const [run] = await db.select().from(syncRuns).where(like(syncRuns.scope, "job:%"));
    expect(run?.scope).toBe("job:events-dispatch");
    expect(run?.status).toBe("succeeded");
    expect(run?.finishedAt).not.toBeNull();
  });

  it("ne fait rien si la tâche tourne déjà", async () => {
    const outcome = await runJob(db, "events-dispatch", { lock: busy });
    expect(outcome).toEqual({ status: "skipped", reason: "already_running" });
    expect(await db.select().from(syncRuns)).toHaveLength(0);
  });

  it("une intégration absente est dite, tracée en échec, sans succès simulé", async () => {
    const outcome = await runJob(db, "sites-coolify", { lock: free });
    // Sans `.env` en test, l'environnement ne se lit pas : la trace le dit aussi, sans lever.
    expect(["not_configured", "failed"]).toContain(outcome.status);
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.scope, "job:sites-coolify"));
    expect(run?.status).toBe("failed");
    expect(run?.error).toBeTruthy();
  });

  it("reconnaît les noms de tâches et aucune autre chaîne", () => {
    expect(isJobName("events-dispatch")).toBe(true);
    expect(isJobName("constructor")).toBe(false);
    expect(isJobName("inconnue")).toBe(false);
    expect(Object.keys(JOBS)).toEqual(
      expect.arrayContaining([
        "events-dispatch",
        "emails-drain",
        "crm-reconcile",
        "sites-coolify",
        "sites-uptime",
        "sites-tls",
        "invoices-overdue",
        "contracts-deadlines",
        "quotes-reminders",
        "projects-budgets",
        "tasks-overdue",
        "domains-expiring",
        "backups-failed",
        "tickets-due",
      ]),
    );
  });

  it("la liste des tâches est réservée à admin:read", async () => {
    const viewer = await createTestContext(db, "viewer");
    const admin = await createTestContext(db, "admin");
    await expect(listJobRuns(viewer)).rejects.toBeInstanceOf(ForbiddenError);
    await runJob(db, "events-dispatch", { lock: free });
    const list = await listJobRuns(admin);
    expect(list.total).toBe(1);
    expect(list.items[0]?.label).toBe("Distribution des événements");
  });
});

describe("tâches qui émettent, une seule fois", () => {
  it("tâches en retard : un événement par tâche et échéance", async () => {
    const project = await createProject(db, { status: "active" });
    await createTask(db, { projectId: project.id, dueOn: "2020-01-01", status: "todo" });
    await runJob(db, "tasks-overdue", { lock: free });
    await runJob(db, "tasks-overdue", { lock: free });
    expect(await eventsOfType("task.overdue")).toHaveLength(1);
  });

  it("domaines à renouveler : un événement par date d'échéance", async () => {
    const company = await createCompany(db);
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await db
      .insert(domains)
      .values({ companyId: company.id, name: "exemple.test", expiresOn: soon, autoRenew: false });
    await runJob(db, "domains-expiring", { lock: free });
    await runJob(db, "domains-expiring", { lock: free });
    expect(await eventsOfType("domain.expiring")).toHaveLength(1);
  });

  it("contenus en retard : J+3 puis J+7, une fois chacun", async () => {
    const admin = await createTestActor(db, "admin");
    const project = await createProject(db, { status: "active" });
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    await db
      .insert(clientRequirements)
      .values({ projectId: project.id, label: "Photos", dueOn: day(-4), status: "expected" });

    await runJob(db, "requirements-overdue", { lock: free });
    await runJob(db, "requirements-overdue", { lock: free });
    const events = await eventsOfType("requirement.overdue");
    expect(events.map((event) => event.dedupeKey?.split(":").at(-1))).toEqual(["j3"]);

    await db
      .update(clientRequirements)
      .set({ dueOn: day(-8) })
      .where(eq(clientRequirements.projectId, project.id));
    await runJob(db, "requirements-overdue", { lock: free });
    expect(await eventsOfType("requirement.overdue")).toHaveLength(2);

    await dispatchPendingEvents(db, {
      deps: { n8n: { isConfigured: false, send: async () => {} } },
    });
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, admin.userId));
    expect(rows).toHaveLength(2);
  });

  it("relance J+7 : un e-mail au contact, posée sur le devis, sans répétition", async () => {
    const admin = await createTestActor(db, "admin");
    const company = await createCompany(db);
    await createContact(db, {
      companyId: company.id,
      email: "contact@exemple.test",
      isPrimary: true,
    });
    const sentAt = new Date(Date.now() - 10 * 86_400_000);
    const { quote } = await createQuote(db, { companyId: company.id, status: "sent", sentAt });

    const n8n = { isConfigured: false, send: async () => {} };
    const smtp = { ...unconfiguredSmtpGateway, isConfigured: true };
    await runJob(db, "quotes-reminders", { lock: free, deps: { smtp } });
    await dispatchPendingEvents(db, { deps: { n8n } });

    const mails = await db.select().from(emailOutbox);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.toAddress).toBe("contact@exemple.test");
    expect(mails[0]?.template).toBe("quote_reminder");
    const [updated] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
    expect(updated?.lastReminderAt).not.toBeNull();

    await runJob(db, "quotes-reminders", { lock: free, deps: { smtp } });
    await dispatchPendingEvents(db, { deps: { n8n } });
    expect(await db.select().from(emailOutbox)).toHaveLength(1);
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, admin.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.href).toBe(`/devis/${quote.id}`);
  });

  it("résumé du matin : une fois par jour, seulement s'il y a du non-lu", async () => {
    const actor = await createTestActor(db, "member");
    await db.insert(userPreferences).values({ userId: actor.userId, dailyDigest: true });
    await runJob(db, "digest-daily", { lock: free });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);

    await db.insert(notifications).values({
      userId: actor.userId,
      kind: "test",
      title: "Alerte",
      dedupeKey: "digest",
    });
    await runJob(db, "digest-daily", { lock: free });
    await runJob(db, "digest-daily", { lock: free });
    const mails = await db.select().from(emailOutbox);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.template).toBe("daily_digest");
  });
});

/**
 * PGlite n'a qu'une connexion : seul un vrai PostgreSQL éprouve le verrou consultatif.
 * Lancé à la demande : `TEST_DATABASE_URL=postgres://… npm test -- automations/jobs`.
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)("verrou consultatif, PostgreSQL réel", () => {
  it("le second lancement renonce, puis le verrou se libère", async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    try {
      const lock = createAdvisoryJobLock(pool);
      let release: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started: () => void = () => undefined;
      const running = new Promise<void>((resolve) => {
        started = resolve;
      });
      const first = lock("essai-verrou", async () => {
        started();
        await hold;
      });
      await running;
      expect(await lock("essai-verrou", async () => undefined)).toBe(false);
      release();
      expect(await first).toBe(true);
      expect(await lock("essai-verrou", async () => undefined)).toBe(true);
    } finally {
      await pool.end();
    }
  });
});

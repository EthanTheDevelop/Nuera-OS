import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatchPendingEvents, listAutomationRuns } from "@/modules/platform/automation.service";
import { AUTOMATION_RULES } from "@/modules/platform/automation.rules";
import { runJob, type JobLock } from "@/modules/platform/jobs.service";
import {
  automationRules,
  automationRuns,
  deliverables,
  domainEvents,
  emailOutbox,
  notifications,
  siteBackups,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestActor, createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createOpportunity,
  createPortalClient,
  createProject,
  createSite,
  createTeamMember,
} from "../../helpers/factories";

let db: Database;

beforeEach(async () => {
  ({ db } = await createTestDatabase());
});

const free: JobLock = async (_name, run) => {
  await run();
  return true;
};
const deps = { n8n: { isConfigured: false, send: async () => {} } };
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const dayOffset = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const eventsOfType = (type: string) =>
  db.select().from(domainEvents).where(eq(domainEvents.type, type));
const notificationsOf = (userId: string) =>
  db.select().from(notifications).where(eq(notifications.userId, userId));

describe("compte des échecs", () => {
  it("compte tous les échecs, mais ne propose de relancer que ceux qui peuvent l'être", async () => {
    const ctx = await createTestContext(db, "admin");
    await db.insert(automationRules).values({
      key: "ancienne_regle",
      name: "Ancienne règle",
      triggerLabel: "Retirée du catalogue",
      actionLabel: "Rien",
      toolLabel: "Nuera OS",
    });
    await db.insert(automationRuns).values({ ruleKey: "ancienne_regle", status: "failed" });
    const runs = await listAutomationRuns(ctx);
    expect(runs.failedTotal).toBe(1);
    expect(runs.failed).toBe(0);
    expect(runs.items[0]?.retryable).toBe(false);
  });
});

describe("catalogue des relances", () => {
  it("chaque nouvel événement a sa règle active", () => {
    for (const type of [
      "opportunity.action_due",
      "deliverable.validation_overdue",
      "backup.missing",
    ]) {
      const rule = AUTOMATION_RULES.find((entry) => entry.events.some((event) => event === type));
      expect(rule?.defaultEnabled, type).toBe(true);
    }
  });
});

describe("rappel d'une affaire (14.01.01)", () => {
  it("prévient la personne responsable une fois par date, jamais une affaire close", async () => {
    const owner = await createTestActor(db, "member");
    const member = await createTeamMember(db, { userId: owner.userId });
    const admin = await createTestActor(db, "admin");
    const due = await createOpportunity(db, {
      stage: "QUALIFIED",
      ownerMemberId: member.id,
      nextAction: "Rappeler le prospect",
      nextActionOn: dayOffset(0),
    });
    await createOpportunity(db, { stage: "QUALIFIED", nextActionOn: dayOffset(3) });
    await createOpportunity(db, { stage: "LOST", nextActionOn: dayOffset(-3) });

    await runJob(db, "opportunities-actions", { lock: free });
    await runJob(db, "opportunities-actions", { lock: free });
    expect(await eventsOfType("opportunity.action_due")).toHaveLength(1);

    await dispatchPendingEvents(db, { deps });
    const rows = await notificationsOf(owner.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.href).toBe(`/pipeline/${due.id}`);
    expect(rows[0]?.title).toContain("Rappeler le prospect");
    expect(await notificationsOf(admin.userId)).toHaveLength(0);
  });

  it("sans responsable, la direction est prévenue", async () => {
    const admin = await createTestActor(db, "admin");
    await createOpportunity(db, { stage: "NEW", nextActionOn: dayOffset(-1) });
    await runJob(db, "opportunities-actions", { lock: free });
    await dispatchPendingEvents(db, { deps });
    expect(await notificationsOf(admin.userId)).toHaveLength(1);
  });
});

describe("relance de validation (14.02.03)", () => {
  async function waitingDeliverable(updatedAt: Date, overrides = {}) {
    const client = await createPortalClient(db);
    const project = await createProject(db, { companyId: client.company.id, status: "active" });
    const [row] = await db
      .insert(deliverables)
      .values({
        projectId: project.id,
        title: "Maquette accueil",
        status: "to_validate",
        requiresClientValidation: true,
        updatedAt,
        ...overrides,
      })
      .returning();
    return { client, project, deliverable: row! };
  }

  it("relance à J+3 puis J+7, une fois chacune, client et responsable prévenus", async () => {
    const admin = await createTestActor(db, "admin");
    const { client, project, deliverable } = await waitingDeliverable(ago(4));

    await runJob(db, "deliverables-overdue", { lock: free });
    await runJob(db, "deliverables-overdue", { lock: free });
    const events = await eventsOfType("deliverable.validation_overdue");
    expect(events.map((event) => event.dedupeKey?.split(":").at(-1))).toEqual(["j3"]);

    await dispatchPendingEvents(db, { deps });
    const mails = await db.select().from(emailOutbox);
    expect(mails.map((mail) => mail.toAddress)).toEqual([client.actor.email]);
    const rows = await notificationsOf(admin.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.href).toBe(`/projets/${project.id}`);

    await db
      .update(deliverables)
      .set({ updatedAt: ago(8) })
      .where(eq(deliverables.id, deliverable.id));
    await runJob(db, "deliverables-overdue", { lock: free });
    expect(await eventsOfType("deliverable.validation_overdue")).toHaveLength(2);
  });

  it("ignore un livrable récent, déjà validé, archivé ou sans validation client", async () => {
    await waitingDeliverable(ago(1));
    await waitingDeliverable(ago(10), { status: "validated" });
    await waitingDeliverable(ago(10), { archivedAt: new Date() });
    await waitingDeliverable(ago(10), { requiresClientValidation: false });
    await runJob(db, "deliverables-overdue", { lock: free });
    expect(await eventsOfType("deliverable.validation_overdue")).toHaveLength(0);
  });
});

describe("sauvegarde absente (14.03.03)", () => {
  it("alerte une fois tant qu'aucune nouvelle sauvegarde n'arrive", async () => {
    const admin = await createTestActor(db, "admin");
    const site = await createSite(db, { status: "live" });
    await db.insert(siteBackups).values({ siteId: site.id, status: "succeeded", takenAt: ago(3) });

    await runJob(db, "backups-failed", { lock: free });
    await runJob(db, "backups-failed", { lock: free });
    expect(await eventsOfType("backup.missing")).toHaveLength(1);

    await dispatchPendingEvents(db, { deps });
    const rows = await notificationsOf(admin.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.href).toBe(`/sites/${site.id}`);
  });

  it("couvre un site relié à Coolify sans aucune sauvegarde, pas un site hors Coolify", async () => {
    await createSite(db, { status: "live", coolifyProjectUuid: "coolify-1" });
    await createSite(db, { status: "live" });
    await runJob(db, "backups-failed", { lock: free });
    expect(await eventsOfType("backup.missing")).toHaveLength(1);
  });

  it("une sauvegarde récente ou un site en pause ne déclenche rien", async () => {
    const fresh = await createSite(db, { status: "live" });
    await db.insert(siteBackups).values({ siteId: fresh.id, status: "succeeded", takenAt: ago(1) });
    const paused = await createSite(db, { status: "paused" });
    await db
      .insert(siteBackups)
      .values({ siteId: paused.id, status: "succeeded", takenAt: ago(9) });
    await runJob(db, "backups-failed", { lock: free });
    expect(await eventsOfType("backup.missing")).toHaveLength(0);
  });
});

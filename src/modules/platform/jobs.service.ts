import { and, count, desc, eq, inArray, isNull, like, lte, max } from "drizzle-orm";
import { getSmtpGateway, SMTP_SERVICE, type SmtpGateway } from "@/integrations/smtp";
import { getCrmGateway } from "@/integrations/twenty";
import { runContractDeadlines } from "@/modules/contracts/contract.service";
import { reconcileCrm } from "@/modules/crm/crm.sync.service";
import { markOverdueInvoices } from "@/modules/finance/finance.service";
import { sweepProjectBudgets } from "@/modules/projects/project.service";
import { addDays, parisDay } from "@/modules/projects/project.rules";
import { listOverdueTasks } from "@/modules/projects/task.service";
import { expireOverdueQuotes, listQuotesDueForReminder } from "@/modules/quotes/quote.service";
import { backupFailedDedupeKey, listFailedBackups } from "@/modules/sites/backup.service";
import { runCoolifySync } from "@/modules/sites/coolify-sync.service";
import { listExpiringDomains, runDomainTlsChecks } from "@/modules/sites/domain.service";
import { runUptimeKumaSync } from "@/modules/sites/monitoring.service";
import { listTicketsNearingDue } from "@/modules/support/ticket.service";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import {
  automationRules,
  clientRequirements,
  deliverables,
  notifications,
  opportunities,
  projects,
  siteBackups,
  sites,
  syncRuns,
  userPreferences,
  users,
} from "@/server/db/schema";
import { getDb, getPool } from "@/server/db/client";
import type { Database } from "@/server/db/types";
import { isAppError, ServiceUnavailableError } from "@/server/errors";
import { logger } from "@/server/logger";
import { dispatchPendingEvents } from "./automation.service";
import { checkAutomaticConnections } from "./connections.service";
import { drainEmailOutbox, enqueueEmail } from "./email-outbox";
import { emitEvent } from "./events";
import { absoluteAppUrl, renderNotificationEmail } from "./notifications.service";
import { createAdvisoryJobLock } from "./job-lock";
import { getAgencyProfile } from "./settings.service";

/**
 * Tâches planifiées, lancées par `POST /api/jobs/[job]` (`docs/ops/jobs.md`). Chacune est répétable
 * et sûre si deux lancements se croisent : verrou consultatif par tâche, puis clés d'idempotence.
 * Elles n'appellent que les fonctions des modules propriétaires.
 */

/**
 * `sync_runs.service` n'accepte que les services d'intégration. Les tâches portent leur nom dans
 * `scope` (`job:<nom>`), et ne se mêlent pas aux traces écrites par les synchronisations elles-mêmes,
 * que les écrans Sites et CRM lisent par service. Voir la demande de schéma du lot.
 */
const JOB_TRACE_SERVICE = "n8n" as const;
const JOB_SCOPE_PREFIX = "job:";

export interface JobDeps {
  smtp?: SmtpGateway;
  now?: Date;
}

interface JobDefinition {
  label: string;
  /** Planification conseillée (cron). */
  schedule: string;
  run: (db: Database, deps: JobDeps) => Promise<number>;
}

async function emitOverdueTasks(db: Database, now: Date): Promise<number> {
  let emitted = 0;
  for (const task of await listOverdueTasks(db, now)) {
    const created = await emitEvent(db, {
      type: "task.overdue",
      entityType: "task",
      entityId: task.id,
      companyId: task.companyId,
      actorId: null,
      dedupeKey: `task.overdue:${task.id}:${task.dueOn}`,
      payload: {
        projectId: task.projectId,
        title: task.title,
        dueOn: task.dueOn,
        assigneeMemberId: task.assigneeMemberId,
      },
    });
    if (created) emitted += 1;
  }
  return emitted;
}

async function emitExpiringDomains(db: Database, now: Date): Promise<number> {
  let emitted = 0;
  for (const domain of await listExpiringDomains(db, now)) {
    if (!domain.expiresOn) continue;
    const created = await emitEvent(db, {
      type: "domain.expiring",
      entityType: "domain",
      entityId: domain.id,
      companyId: domain.companyId,
      actorId: null,
      dedupeKey: `domain.expiring:${domain.id}:${domain.expiresOn}`,
      payload: { name: domain.name, siteId: domain.siteId, expiresOn: domain.expiresOn },
    });
    if (created) emitted += 1;
  }
  return emitted;
}

async function emitFailedBackups(db: Database, now: Date): Promise<number> {
  let emitted = 0;
  for (const backup of await listFailedBackups(db, now)) {
    const created = await emitEvent(db, {
      type: "backup.failed",
      entityType: "site_backup",
      entityId: backup.id,
      companyId: backup.companyId,
      actorId: null,
      dedupeKey: backupFailedDedupeKey(backup.id),
      payload: {
        siteId: backup.siteId,
        environmentId: backup.environmentId,
        takenAt: backup.takenAt?.toISOString() ?? null,
      },
    });
    if (created) emitted += 1;
  }
  return emitted;
}

async function emitTicketsDueSoon(db: Database, now: Date): Promise<number> {
  let emitted = 0;
  for (const ticket of await listTicketsNearingDue(db, now)) {
    if (!ticket.dueAt) continue;
    const dueAt = ticket.dueAt.toISOString();
    const created = await emitEvent(db, {
      type: "ticket.due_soon",
      entityType: "ticket",
      entityId: ticket.id,
      companyId: ticket.companyId,
      actorId: null,
      dedupeKey: `ticket.due_soon:${ticket.id}:${dueAt}`,
      payload: { number: ticket.number, subject: ticket.subject, dueAt },
    });
    if (created) emitted += 1;
  }
  return emitted;
}

/**
 * Expire les devis dépassés, puis prépare les relances J+7, sauf règle désactivée. Sans serveur
 * d'envoi : aucune relance ne se prétend faite, elles restent dues et la tâche le dit (écran 24).
 */
async function runQuoteJob(db: Database, now: Date, deps: JobDeps): Promise<number> {
  const expired = await expireOverdueQuotes(db, now);
  const [rule] = await db
    .select({ enabled: automationRules.enabled })
    .from(automationRules)
    .where(eq(automationRules.key, "quote_reminder"))
    .limit(1);
  // Règle désactivée : pas d'événement, la relance reste due le jour où elle sera réactivée.
  if (rule && !rule.enabled) return expired.length;

  const due = await listQuotesDueForReminder(db, now);
  if (due.length > 0 && !(deps.smtp ?? getSmtpGateway()).isConfigured) {
    throw new ServiceUnavailableError(
      SMTP_SERVICE,
      "not_configured",
      `Connexion requise : ${due.length} relance(s) de devis attendent le serveur d'envoi.`,
    );
  }

  let emitted = 0;
  for (const quote of due) {
    const since = (quote.lastReminderAt ?? quote.sentAt ?? now).toISOString();
    const created = await emitEvent(db, {
      type: "quote.reminder_due",
      entityType: "quote",
      entityId: quote.id,
      companyId: quote.companyId,
      actorId: null,
      dedupeKey: `quote.reminder_due:${quote.id}:${since}`,
      payload: { number: quote.number, since },
    });
    if (created) emitted += 1;
  }
  return expired.length + emitted;
}

const DAY_MS = 86_400_000;
const BACKUP_MAX_AGE_MS = 2 * DAY_MS;

const REQUIREMENT_STAGES = [
  { stage: "j7", days: 7 },
  { stage: "j3", days: 3 },
] as const;

/** Contenus attendus en retard : une relance à J+3, une à J+7. */
async function emitOverdueRequirements(db: Database, now: Date): Promise<number> {
  const today = parisDay(now);
  const rows = await db
    .select({
      id: clientRequirements.id,
      label: clientRequirements.label,
      dueOn: clientRequirements.dueOn,
      projectId: clientRequirements.projectId,
      projectName: projects.name,
      companyId: projects.companyId,
    })
    .from(clientRequirements)
    .innerJoin(projects, eq(projects.id, clientRequirements.projectId))
    .where(
      and(
        eq(clientRequirements.status, "expected"),
        isNull(clientRequirements.archivedAt),
        isNull(projects.archivedAt),
        inArray(projects.status, ["preparation", "active", "blocked", "in_validation"]),
        lte(clientRequirements.dueOn, addDays(today, -3)),
      ),
    );

  let emitted = 0;
  for (const row of rows) {
    const { dueOn } = row;
    if (!dueOn) continue;
    const stage = REQUIREMENT_STAGES.find(({ days }) => dueOn <= addDays(today, -days));
    if (!stage) continue;
    const created = await emitEvent(db, {
      type: "requirement.overdue",
      entityType: "client_requirement",
      entityId: row.id,
      companyId: row.companyId,
      actorId: null,
      dedupeKey: `requirement.overdue:${row.id}:${stage.stage}`,
      payload: {
        projectId: row.projectId,
        projectName: row.projectName,
        label: row.label,
        dueOn,
        stage: stage.stage,
      },
    });
    if (created) emitted += 1;
  }
  return emitted;
}

/** Livrables soumis sans retour du client : une relance à J+3, une à J+7, par version. */
async function emitOverdueValidations(db: Database, now: Date): Promise<number> {
  const rows = await db
    .select({
      id: deliverables.id,
      title: deliverables.title,
      version: deliverables.version,
      updatedAt: deliverables.updatedAt,
      projectId: deliverables.projectId,
      projectName: projects.name,
      companyId: projects.companyId,
    })
    .from(deliverables)
    .innerJoin(projects, eq(projects.id, deliverables.projectId))
    .where(
      and(
        eq(deliverables.status, "to_validate"),
        eq(deliverables.requiresClientValidation, true),
        isNull(deliverables.archivedAt),
        isNull(projects.archivedAt),
        inArray(projects.status, ["preparation", "active", "blocked", "in_validation"]),
        lte(deliverables.updatedAt, new Date(now.getTime() - 3 * DAY_MS)),
      ),
    );

  let emitted = 0;
  for (const row of rows) {
    const waited = now.getTime() - row.updatedAt.getTime();
    const stage = waited >= 7 * DAY_MS ? "j7" : "j3";
    const created = await emitEvent(db, {
      type: "deliverable.validation_overdue",
      entityType: "deliverable",
      entityId: row.id,
      companyId: row.companyId,
      actorId: null,
      dedupeKey: `deliverable.validation_overdue:${row.id}:${row.version}:${stage}`,
      payload: {
        projectId: row.projectId,
        projectName: row.projectName,
        title: row.title,
        version: row.version,
        stage,
      },
    });
    if (created) emitted += 1;
  }
  return emitted;
}

/** Affaires ouvertes dont la prochaine action est due : un rappel par date. */
async function emitDueOpportunityActions(db: Database, now: Date): Promise<number> {
  const rows = await db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      companyId: opportunities.companyId,
      nextAction: opportunities.nextAction,
      nextActionOn: opportunities.nextActionOn,
      ownerMemberId: opportunities.ownerMemberId,
    })
    .from(opportunities)
    .where(
      and(
        isNull(opportunities.archivedAt),
        inArray(opportunities.stage, ["NEW", "QUALIFIED", "QUOTE_SENT", "NEGOTIATION"]),
        lte(opportunities.nextActionOn, parisDay(now)),
      ),
    );

  let emitted = 0;
  for (const row of rows) {
    if (!row.nextActionOn) continue;
    const created = await emitEvent(db, {
      type: "opportunity.action_due",
      entityType: "opportunity",
      entityId: row.id,
      companyId: row.companyId,
      actorId: null,
      dedupeKey: `opportunity.action_due:${row.id}:${row.nextActionOn}`,
      payload: {
        name: row.name,
        nextAction: row.nextAction,
        nextActionOn: row.nextActionOn,
        ownerMemberId: row.ownerMemberId,
      },
    });
    if (created) emitted += 1;
  }
  return emitted;
}

/**
 * Sites en ligne sans sauvegarde réussie depuis 48 h. Un site sans aucune sauvegarde n'est signalé
 * que s'il est relié à Coolify : sinon, rien ne dit qu'une sauvegarde est attendue.
 */
async function emitMissingBackups(db: Database, now: Date): Promise<number> {
  const rows = await db
    .select({
      id: sites.id,
      name: sites.name,
      companyId: sites.companyId,
      coolifyProjectUuid: sites.coolifyProjectUuid,
      lastSuccessAt: max(siteBackups.takenAt),
      backups: count(siteBackups.id),
    })
    .from(sites)
    .leftJoin(
      siteBackups,
      and(eq(siteBackups.siteId, sites.id), eq(siteBackups.status, "succeeded")),
    )
    .where(and(eq(sites.status, "live"), isNull(sites.archivedAt)))
    .groupBy(sites.id);

  const cutoff = now.getTime() - BACKUP_MAX_AGE_MS;
  let emitted = 0;
  for (const row of rows) {
    const lastBackupAt = row.lastSuccessAt ? new Date(row.lastSuccessAt) : null;
    if (lastBackupAt && lastBackupAt.getTime() >= cutoff) continue;
    if (!lastBackupAt && !row.coolifyProjectUuid) continue;
    const created = await emitEvent(db, {
      type: "backup.missing",
      entityType: "site",
      entityId: row.id,
      companyId: row.companyId,
      actorId: null,
      dedupeKey: `backup.missing:${row.id}:${lastBackupAt?.toISOString() ?? "jamais"}`,
      payload: { name: row.name, lastBackupAt: lastBackupAt?.toISOString() ?? null },
    });
    if (created) emitted += 1;
  }
  return emitted;
}

/** « Résumé chaque matin » : une fois par jour et par compte, s'il y a du non-lu. */
async function sendDailyDigest(db: Database, now: Date): Promise<number> {
  const day = parisDay(now);
  const accounts = await db
    .select({ id: users.id, email: users.email })
    .from(userPreferences)
    .innerJoin(users, eq(users.id, userPreferences.userId))
    .where(and(eq(userPreferences.dailyDigest, true), eq(users.banned, false)));

  let queued = 0;
  for (const account of accounts) {
    const [row] = await db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, account.id), isNull(notifications.readAt)));
    const unread = row?.value ?? 0;
    if (unread === 0) continue;
    const { text, html } = renderNotificationEmail({
      title: unread > 1 ? `${unread} notifications à lire` : "1 notification à lire",
      body: "Votre résumé du matin sur Nuera OS.",
      url: absoluteAppUrl("/profil/notifications"),
    });
    await enqueueEmail(db, {
      to: account.email,
      subject: "Votre résumé du matin",
      text,
      html,
      template: "daily_digest",
      dedupeKey: `daily_digest:${account.id}:${day}`,
    });
    queued += 1;
  }
  return queued;
}

const JOB_DEFINITIONS = {
  "events-dispatch": {
    label: "Distribution des événements",
    schedule: "* * * * *",
    run: async (db, { now }) => {
      const result = await dispatchPendingEvents(db, { now });
      return result.succeeded + result.failed;
    },
  },
  "emails-drain": {
    label: "Envoi des e-mails",
    schedule: "* * * * *",
    run: async (db, { smtp, now }) => {
      const { replyTo } = await getAgencyProfile(db);
      const result = await drainEmailOutbox(db, smtp ?? getSmtpGateway(), { now, replyTo });
      return result.sent;
    },
  },
  "crm-reconcile": {
    label: "Réconciliation du CRM",
    schedule: "*/15 * * * *",
    run: async (db, { now }) => {
      const result = await reconcileCrm({ db, crm: getCrmGateway() }, { now });
      return result.items;
    },
  },
  "sites-coolify": {
    label: "Synchronisation Coolify",
    schedule: "*/5 * * * *",
    run: async (db, { now }) => (await runCoolifySync(db, { now })).items,
  },
  "sites-uptime": {
    label: "Lecture d'Uptime Kuma",
    schedule: "*/5 * * * *",
    run: async (db, { now }) => (await runUptimeKumaSync(db, { now })).items,
  },
  "sites-tls": {
    label: "Contrôle des certificats",
    schedule: "0 5 * * *",
    run: async (db, { now }) => (await runDomainTlsChecks(db, { now })).checked,
  },
  "domains-expiring": {
    label: "Domaines à renouveler",
    schedule: "15 5 * * *",
    run: (db, { now }) => emitExpiringDomains(db, now ?? new Date()),
  },
  "backups-failed": {
    label: "Sauvegardes en échec ou absentes",
    schedule: "0 * * * *",
    run: async (db, { now }) => {
      const at = now ?? new Date();
      return (await emitFailedBackups(db, at)) + (await emitMissingBackups(db, at));
    },
  },
  "invoices-overdue": {
    label: "Factures en retard",
    schedule: "0 6 * * *",
    run: (db, { now }) => markOverdueInvoices(db, now),
  },
  "contracts-deadlines": {
    label: "Échéances des contrats",
    schedule: "10 6 * * *",
    run: async (db, { now }) => {
      const result = await runContractDeadlines(db, { now });
      return result.renewed + result.expired + result.alerted;
    },
  },
  "quotes-reminders": {
    label: "Relances et expiration des devis",
    schedule: "20 6 * * *",
    run: (db, deps) => runQuoteJob(db, deps.now ?? new Date(), deps),
  },
  "projects-budgets": {
    label: "Contrôle des budgets",
    schedule: "30 6 * * *",
    run: (db) => sweepProjectBudgets(db),
  },
  "tasks-overdue": {
    label: "Tâches en retard",
    schedule: "40 6 * * *",
    run: (db, { now }) => emitOverdueTasks(db, now ?? new Date()),
  },
  "requirements-overdue": {
    label: "Contenus attendus en retard",
    schedule: "50 6 * * *",
    run: (db, { now }) => emitOverdueRequirements(db, now ?? new Date()),
  },
  "deliverables-overdue": {
    label: "Validations client en retard",
    schedule: "55 6 * * *",
    run: (db, { now }) => emitOverdueValidations(db, now ?? new Date()),
  },
  "opportunities-actions": {
    label: "Prochaines actions des affaires",
    schedule: "45 6 * * *",
    run: (db, { now }) => emitDueOpportunityActions(db, now ?? new Date()),
  },
  "tickets-due": {
    label: "Demandes bientôt hors délai",
    schedule: "*/30 * * * *",
    run: (db, { now }) => emitTicketsDueSoon(db, now ?? new Date()),
  },
  "digest-daily": {
    label: "Résumé du matin",
    schedule: "0 7 * * *",
    run: (db, { now }) => sendDailyDigest(db, now ?? new Date()),
  },
  "connections-check": {
    label: "Vérification des connexions",
    schedule: "0 * * * *",
    run: (db, { now }) => checkAutomaticConnections(db, { now }),
  },
} as const satisfies Record<string, JobDefinition>;

export type JobName = keyof typeof JOB_DEFINITIONS;

export const JOBS: Readonly<Record<JobName, JobDefinition>> = JOB_DEFINITIONS;

export function isJobName(value: string): value is JobName {
  return Object.prototype.hasOwnProperty.call(JOB_DEFINITIONS, value);
}

/** Verrou par tâche : vrai si l'exécution a eu lieu. Voir `job-lock.ts` pour PostgreSQL. */
export type JobLock = (name: string, run: () => Promise<void>) => Promise<boolean>;

export type JobOutcome =
  | { status: "succeeded"; items: number }
  | { status: "failed" | "not_configured"; error: string }
  | { status: "skipped"; reason: "already_running" };

/** Lance une tâche sous verrou et la trace dans `sync_runs`. Ne lève jamais : le résultat le dit. */
export async function runJob(
  db: Database,
  name: JobName,
  options: { lock: JobLock; deps?: JobDeps },
): Promise<JobOutcome> {
  const job = JOBS[name];
  const results: JobOutcome[] = [];

  await options.lock(name, async () => {
    const [run] = await db
      .insert(syncRuns)
      .values({ service: JOB_TRACE_SERVICE, scope: `${JOB_SCOPE_PREFIX}${name}` })
      .returning({ id: syncRuns.id });
    if (!run) throw new Error("Trace de tâche sans résultat.");
    try {
      const items = await job.run(db, options.deps ?? {});
      results.push({ status: "succeeded", items });
      await db
        .update(syncRuns)
        .set({ status: "succeeded", items, finishedAt: new Date() })
        .where(eq(syncRuns.id, run.id));
    } catch (error) {
      const message = isAppError(error) ? error.message : "Erreur interne de la tâche.";
      if (!isAppError(error)) logger.error("job.failed", { job: name, error });
      results.push(
        error instanceof ServiceUnavailableError && error.reason === "not_configured"
          ? { status: "not_configured", error: message }
          : { status: "failed", error: message },
      );
      await db
        .update(syncRuns)
        .set({ status: "failed", error: message, finishedAt: new Date() })
        .where(eq(syncRuns.id, run.id));
    }
  });
  return results[0] ?? { status: "skipped", reason: "already_running" };
}

/** Pour la route HTTP : la base de l'application et le verrou PostgreSQL. */
export function runApplicationJob(name: JobName): Promise<JobOutcome> {
  return runJob(getDb(), name, { lock: createAdvisoryJobLock(getPool()) });
}

// --- Lecture pour l'écran 24 --------------------------------------------------------------------

export interface JobRunView {
  id: string;
  job: string;
  label: string;
  status: "running" | "succeeded" | "failed";
  items: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export async function listJobRuns(
  ctx: ServiceContext,
  options: { page?: number; pageSize?: number } = {},
) {
  assertCan(ctx.actor, "admin:read");
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const where = like(syncRuns.scope, `${JOB_SCOPE_PREFIX}%`);
  const [rows, totals] = await Promise.all([
    ctx.db
      .select()
      .from(syncRuns)
      .where(where)
      .orderBy(desc(syncRuns.startedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    ctx.db.select({ value: count() }).from(syncRuns).where(where),
  ]);
  const items: JobRunView[] = rows.map((row) => {
    const job = (row.scope ?? "").slice(JOB_SCOPE_PREFIX.length);
    return {
      id: row.id,
      job,
      label: isJobName(job) ? JOBS[job].label : job,
      status: row.status,
      items: row.items,
      error: row.error,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    };
  });
  return { items, total: totals[0]?.value ?? 0, page, pageSize };
}

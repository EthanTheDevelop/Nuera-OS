import type { AutomationRunStatus } from "@/lib/domain-enums";
import { z } from "@/lib/zod";
import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { DomainEventRow } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, isAppError, NotFoundError } from "@/server/errors";
import { logger } from "@/server/logger";
import { parseInput } from "@/server/validation";
import * as repository from "./automation.repository";
import {
  AUTOMATION_GROUPS,
  AUTOMATION_RULES,
  findRuleDefinition,
  rulesForEvent,
  type AutomationDeps,
  type AutomationGroup,
  type AutomationRuleDefinition,
} from "./automation.rules";

/** Tentatives automatiques d'une règle sur un événement, avant de laisser la main à l'interface. */
export const MAX_AUTOMATIC_ATTEMPTS = 3;
/** Attente entre deux tentatives automatiques : `attempts × 5` minutes. */
const RETRY_DELAY_MS = 5 * 60_000;
/** Une exécution « en cours » depuis plus longtemps a été interrompue : elle se reprend. */
const STALE_RUN_MS = 15 * 60_000;
const DEFAULT_BATCH = 200;
/** Message d'erreur conservé : assez pour comprendre, jamais de pile. */
const MAX_ERROR_LENGTH = 500;

const CATALOGUE_KEYS = AUTOMATION_RULES.map((rule) => rule.key);

/** Écrit le catalogue en base : `automation_runs` y fait référence. Ne touche jamais `enabled`. */
export async function ensureAutomationRules(db: Database): Promise<void> {
  await repository.upsertRules(
    db,
    AUTOMATION_RULES.map((rule) => ({
      key: rule.key,
      name: rule.name,
      triggerLabel: rule.trigger,
      actionLabel: rule.action,
      toolLabel: rule.tool,
      enabled: rule.defaultEnabled,
    })),
  );
}

function errorMessage(error: unknown): string {
  const raw = isAppError(error)
    ? error.message
    : error instanceof Error
      ? "Erreur interne de l'automatisation."
      : "Erreur inconnue.";
  return raw.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Exécute une règle. L'écriture et la fin de l'exécution sont dans la même transaction : un échec
 * annule toutes les écritures de la tentative, et la relance repart de zéro sans doublon.
 */
async function execute(
  db: Database,
  rule: AutomationRuleDefinition,
  event: DomainEventRow,
  runId: string,
  now: Date,
  deps: AutomationDeps,
): Promise<"succeeded" | "failed" | "skipped"> {
  const execution = { event, now, deps };
  try {
    if (rule.prepare) await rule.prepare(db, execution);
    return await db.transaction(async (tx) => {
      const result = await rule.run(tx, execution);
      const status = result?.status ?? "succeeded";
      await repository.finishRun(tx, runId, {
        status,
        error: null,
        result: result?.detail ?? null,
        at: new Date(),
      });
      return status;
    });
  } catch (error) {
    const message = errorMessage(error);
    if (!isAppError(error)) {
      logger.error("automation.rule_failed", { rule: rule.key, eventId: event.id, error });
    }
    await repository.finishRun(db, runId, {
      status: "failed",
      error: message,
      result: null,
      at: new Date(),
    });
    return "failed";
  }
}

export interface DispatchResult {
  events: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Événements gardés pour une prochaine tentative automatique. */
  retained: number;
}

/**
 * Répartiteur : lit `domain_events` non distribués, fait agir chaque règle active une seule fois
 * (`automation_runs` unique par règle et événement). Répétable et sûr si deux lancements se
 * croisent. Un échec est tracé puis retenté un nombre borné de fois ; ensuite l'événement sort de la
 * file et l'écran 12 propose « Relancer sans doublon ». Une règle désactivée n'agit pas.
 */
export async function dispatchPendingEvents(
  db: Database,
  options: { limit?: number; now?: Date; deps?: AutomationDeps } = {},
): Promise<DispatchResult> {
  const now = options.now ?? new Date();
  const deps = options.deps ?? {};
  await ensureAutomationRules(db);

  const rows = await repository.listRules(db);
  const enabled = new Set(rows.filter((row) => row.enabled).map((row) => row.key));
  const events = await repository.listPendingEvents(db, options.limit ?? DEFAULT_BATCH);
  const result: DispatchResult = {
    events: events.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    retained: 0,
  };

  for (const event of events) {
    let keep = false;
    for (const rule of rulesForEvent(event.type)) {
      if (!enabled.has(rule.key)) continue;
      const outcome = await runRuleOnce(db, rule, event, now, deps);
      if (outcome.status === "succeeded") result.succeeded += 1;
      if (outcome.status === "skipped") result.skipped += 1;
      if (outcome.status === "failed") result.failed += 1;
      if (outcome.retry) keep = true;
    }
    if (keep) result.retained += 1;
    else await repository.markEventDispatched(db, event.id, now);
  }
  return result;
}

type RuleOutcome = { status: "succeeded" | "failed" | "skipped" | "none"; retry: boolean };

async function runRuleOnce(
  db: Database,
  rule: AutomationRuleDefinition,
  event: DomainEventRow,
  now: Date,
  deps: AutomationDeps,
): Promise<RuleOutcome> {
  const fresh = await repository.claimNewRun(db, rule.key, event.id, now);
  if (fresh) {
    const status = await execute(db, rule, event, fresh.id, now, deps);
    return { status, retry: status === "failed" && fresh.attempts < MAX_AUTOMATIC_ATTEMPTS };
  }

  const existing = await repository.findRun(db, rule.key, event.id);
  if (!existing) return { status: "none", retry: false };
  if (existing.status === "succeeded" || existing.status === "skipped") {
    return { status: "none", retry: false };
  }

  const staleBefore = new Date(now.getTime() - STALE_RUN_MS);
  if (existing.status === "running") {
    // Une autre exécution travaille : l'événement reste en file pour la vérifier ensuite.
    if (existing.startedAt > staleBefore) return { status: "none", retry: true };
  } else {
    if (existing.attempts >= MAX_AUTOMATIC_ATTEMPTS) return { status: "none", retry: false };
    const waited = now.getTime() - (existing.finishedAt ?? existing.startedAt).getTime();
    if (waited < existing.attempts * RETRY_DELAY_MS) return { status: "none", retry: true };
  }

  const claimed = await repository.reclaimRun(db, {
    id: existing.id,
    expectedAttempts: existing.attempts,
    staleBefore,
    at: now,
  });
  if (!claimed) return { status: "none", retry: true };
  const status = await execute(db, rule, event, claimed.id, now, deps);
  return { status, retry: status === "failed" && claimed.attempts < MAX_AUTOMATIC_ATTEMPTS };
}

// --- Lecture ------------------------------------------------------------------------------------

function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface AutomationsSummary {
  rulesEnabled: number;
  rulesTotal: number;
  runsThisMonth: number;
  failed: number;
  lastRuns: { ruleName: string; status: AutomationRunStatus; at: Date }[];
}

/** Tuile du tableau de bord. Lecture système, sans acteur : aucune donnée personnelle. */
export async function getAutomationsSummary(
  db: Database,
  now: Date = new Date(),
): Promise<AutomationsSummary> {
  await ensureAutomationRules(db);
  const [rules, counts, failed, last] = await Promise.all([
    repository.listRules(db),
    repository.countRunsByRule(db, startOfMonth(now)),
    repository.countFailedRuns(db, CATALOGUE_KEYS),
    repository.listRuns(db, { limit: 3, offset: 0 }),
  ]);
  // Seul le catalogue en code compte : une ligne d'une ancienne règle n'est plus une automatisation.
  const catalogue = rules.filter((rule) => findRuleDefinition(rule.key));
  return {
    rulesEnabled: catalogue.filter((rule) => rule.enabled).length,
    rulesTotal: catalogue.length,
    runsThisMonth: counts
      .filter((row) => row.status === "succeeded")
      .reduce((sum, row) => sum + row.value, 0),
    failed,
    lastRuns: last.map((row) => ({
      ruleName: row.ruleName,
      status: row.status,
      at: row.finishedAt ?? row.startedAt,
    })),
  };
}

export interface AutomationRuleView {
  key: string;
  name: string;
  trigger: string;
  action: string;
  tool: string;
  icon: AutomationRuleDefinition["icon"];
  enabled: boolean;
  /** Exécutions réussies ce mois-ci. */
  runsThisMonth: number;
  failedThisMonth: number;
}

export interface AutomationGroupView {
  group: AutomationGroup;
  rules: AutomationRuleView[];
}

export async function listAutomationRules(
  ctx: ServiceContext,
  now: Date = new Date(),
): Promise<AutomationGroupView[]> {
  assertCan(ctx.actor, "automations:read");
  await ensureAutomationRules(ctx.db);
  const [rows, counts] = await Promise.all([
    repository.listRules(ctx.db),
    repository.countRunsByRule(ctx.db, startOfMonth(now)),
  ]);
  const enabled = new Map(rows.map((row) => [row.key, row.enabled]));
  const count = (key: string, status: string) =>
    counts.find((row) => row.ruleKey === key && row.status === status)?.value ?? 0;
  return AUTOMATION_GROUPS.map((group) => ({
    group,
    rules: AUTOMATION_RULES.filter((rule) => rule.group === group).map((rule) => ({
      key: rule.key,
      name: rule.name,
      trigger: rule.trigger,
      action: rule.action,
      tool: rule.tool,
      icon: rule.icon,
      enabled: enabled.get(rule.key) ?? rule.defaultEnabled,
      runsThisMonth: count(rule.key, "succeeded"),
      failedThisMonth: count(rule.key, "failed"),
    })),
  }));
}

/** Une règle désactivée n'agit pas, même relancée : seules les règles actives se relancent. */
async function enabledCatalogueKeys(db: Database): Promise<string[]> {
  const rows = await repository.listRules(db);
  return rows.filter((row) => row.enabled && findRuleDefinition(row.key)).map((row) => row.key);
}

const runsQuerySchema = z.object({
  status: z.enum(["running", "succeeded", "failed", "skipped"]).optional(),
  ruleKey: z.string().max(100).optional(),
  // Paramètre d'URL : une valeur illisible vaut la première page.
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function listAutomationRuns(ctx: ServiceContext, rawQuery: unknown = {}) {
  assertCan(ctx.actor, "automations:read");
  const query = parseInput(runsQuerySchema, rawQuery);
  const retryableKeys = await enabledCatalogueKeys(ctx.db);
  const [items, total, failed, failedTotal] = await Promise.all([
    repository.listRuns(ctx.db, {
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
      status: query.status,
      ruleKey: query.ruleKey,
    }),
    repository.countRuns(ctx.db, { status: query.status, ruleKey: query.ruleKey }),
    repository.countFailedRuns(ctx.db, retryableKeys),
    repository.countRuns(ctx.db, { status: "failed" }),
  ]);
  return {
    items: items.map((row) => ({
      ...row,
      retryable:
        row.status === "failed" && row.eventId !== null && retryableKeys.includes(row.ruleKey),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    /** Échecs qu'on peut relancer (règle active, événement connu) : commandent le bouton. */
    failed,
    /** Tous les échecs, y compris sans événement ni règle au catalogue : ce que voit la liste. */
    failedTotal,
  };
}

// --- Écriture -----------------------------------------------------------------------------------

const toggleSchema = z.object({ key: z.string().min(1).max(100), enabled: z.boolean() });

export async function setAutomationRuleEnabled(
  ctx: ServiceContext,
  rawInput: unknown,
): Promise<void> {
  assertCan(ctx.actor, "automations:manage");
  const input = parseInput(toggleSchema, rawInput);
  if (!findRuleDefinition(input.key)) throw new NotFoundError("Automatisation introuvable.");
  await ensureAutomationRules(ctx.db);
  await ctx.db.transaction(async (tx) => {
    const current = await repository.findRule(tx, input.key);
    if (!current) throw new NotFoundError("Automatisation introuvable.");
    if (current.enabled === input.enabled) return;
    await repository.setRuleEnabled(tx, input.key, input.enabled);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: input.enabled ? "automation_rule.enabled" : "automation_rule.disabled",
      entityType: "automation_rule",
      metadata: { key: input.key, name: current.name },
    });
  });
}

/**
 * « Relancer sans doublon » : reprend une exécution en échec. Sa ligne est réutilisée, et les clés
 * de notification et d'e-mail ne changent pas : rien ne part deux fois. Répétable.
 */
export async function retryAutomationRun(
  ctx: ServiceContext,
  runId: string,
  options: { now?: Date; deps?: AutomationDeps } = {},
): Promise<"succeeded" | "failed" | "skipped"> {
  assertCan(ctx.actor, "automations:manage");
  const id = parseInput(z.uuid(), runId);
  const now = options.now ?? new Date();
  const run = await repository.findRunById(ctx.db, id);
  if (!run) throw new NotFoundError("Exécution introuvable.");
  if (run.status !== "failed") {
    throw new ConflictError("Cette exécution n'est plus en échec.");
  }
  const rule = findRuleDefinition(run.ruleKey);
  const event = run.eventId ? await repository.findEvent(ctx.db, run.eventId) : null;
  if (!rule || !event) {
    throw new ConflictError("Cette exécution ne peut plus être relancée : sa règle a disparu.");
  }
  const stored = await repository.findRule(ctx.db, run.ruleKey);
  if (!stored?.enabled) {
    throw new ConflictError("Cette automatisation est désactivée : réactivez-la pour la relancer.");
  }
  const claimed = await repository.reclaimRun(ctx.db, {
    id: run.id,
    expectedAttempts: run.attempts,
    staleBefore: new Date(now.getTime() - STALE_RUN_MS),
    at: now,
  });
  if (!claimed) throw new ConflictError("Cette exécution vient d'être relancée.");
  await recordAudit(ctx.db, {
    actorId: ctx.actor.userId,
    action: "automation_run.retried",
    entityType: "automation_run",
    entityId: run.id,
    metadata: { rule: run.ruleKey, eventId: event.id },
  });
  const status = await execute(ctx.db, rule, event, run.id, now, options.deps ?? {});
  // Une autre règle de cet événement peut encore avoir des essais automatiques : il reste en file.
  if (
    status !== "failed" &&
    !(await repository.hasOpenRuns(ctx.db, event.id, MAX_AUTOMATIC_ATTEMPTS))
  ) {
    await repository.markEventDispatched(ctx.db, event.id, now);
  }
  return status;
}

/** Relance toutes les exécutions en échec, les plus récentes d'abord (borné). */
export async function retryFailedAutomationRuns(
  ctx: ServiceContext,
  options: { limit?: number; deps?: AutomationDeps } = {},
): Promise<{ retried: number; stillFailing: number }> {
  assertCan(ctx.actor, "automations:manage");
  const ids = await repository.listFailedRunIds(
    ctx.db,
    await enabledCatalogueKeys(ctx.db),
    options.limit ?? 50,
  );
  let stillFailing = 0;
  let retried = 0;
  for (const id of ids) {
    try {
      const status = await retryAutomationRun(ctx, id, { deps: options.deps });
      retried += 1;
      if (status === "failed") stillFailing += 1;
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
    }
  }
  return { retried, stillFailing };
}

import { recordAudit } from "@/modules/audit/audit.service";
import { emitEvent } from "@/modules/platform/events";
import {
  getAssignedProjectIds,
  getMemberIdForUser,
  isAssignedToProject,
} from "@/modules/team/team.lookup";
import { TIME_CATEGORY_LABELS, type TimeCategory } from "@/lib/domain-enums";
import { assertCan, assertCanAny, can } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { paginated, pageOffset, type PageParams, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import {
  addDays,
  eachDay,
  monthRange,
  parisToday,
  weekEnd,
  weekKey,
  weekLabel,
  weekStart,
  type DayRange,
} from "./calendar";
import {
  getCapacityOverview,
  getSixWeekLoad,
  type CapacityOverview,
  type WeekLoad,
} from "./capacity.service";
import * as timeRepository from "./time.repository";
import { isUuid, MAX_MINUTES_PER_DAY, timeEntrySchema, timesheetCellSchema } from "./time.schema";

/** Sérialise les écritures d'un membre sur un jour : le plafond de 24 h tient même en simultané. */
function lockMemberDay(tx: Database, memberId: string, workOn: string): Promise<void> {
  return timeRepository.lockKey(tx, `time:day:${memberId}:${workOn}`);
}

export {
  getCapacityOverview,
  getSixWeekLoad,
  simulateNewProject,
  type CapacityOverview,
  type MemberCapacity,
  type ProjectSimulation,
  type WeekLoad,
} from "./capacity.service";

/** Seuil A7 : consommation de budget signalée à 80 %. */
export const BUDGET_ALERT_PERCENT = 80;

/** Fenêtre dans laquelle une saisie identique du même compte est un double envoi. */
const DUPLICATE_WINDOW_MS = 10_000;

const NO_ATTACHMENT_CATEGORIES: readonly TimeCategory[] = ["prospecting", "admin"];

// --- Lectures exposées aux autres modules (sans contrôle d'accès : l'appelant est un service) ---

export interface ProjectTimeTotals {
  projectId: string;
  minutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  /** Coût du temps : donnée sensible, à ne montrer qu'avec `team:read_costs`. */
  costCents: number;
  estimatedMinutes: number | null;
  /** Consommé / estimé ; `null` sans estimation. */
  minutesPercent: number | null;
  budgetCents: number | null;
  /** Coût du temps / budget ; `null` sans budget. Sensible, comme `costCents`. */
  budgetPercent: number | null;
}

/** Temps d'un projet : total, facturable, coût figé, consommation de l'enveloppe. */
export async function getProjectTimeTotals(
  db: Database,
  projectId: string,
): Promise<ProjectTimeTotals> {
  const [totals, envelope] = await Promise.all([
    timeRepository.sumTimeForProject(db, projectId),
    timeRepository.getProjectEnvelope(db, projectId),
  ]);
  const estimatedMinutes = envelope?.estimatedMinutes ?? null;
  const budgetCents = envelope?.budgetCents ?? null;
  return {
    projectId,
    minutes: totals.minutes,
    billableMinutes: totals.billableMinutes,
    nonBillableMinutes: totals.minutes - totals.billableMinutes,
    costCents: totals.costCents,
    estimatedMinutes,
    minutesPercent:
      estimatedMinutes && estimatedMinutes > 0
        ? Math.round((totals.minutes / estimatedMinutes) * 100)
        : null,
    budgetCents,
    budgetPercent:
      budgetCents && budgetCents > 0 ? Math.round((totals.costCents / budgetCents) * 100) : null,
  };
}

/** Mêmes portées que `getMargin` (`docs/domain-model.md` §6). Bornes de période incluses. */
export interface TimeScope {
  scope: "project" | "client" | "site" | "contract";
  id: string;
  period?: DayRange | null;
}

export interface ScopeTimeTotals {
  minutes: number;
  billableMinutes: number;
  costCents: number;
}

/** Temps et coût d'une portée. Le coût vient toujours de `minutes × hourly_cost_cents` figé. */
export function getTimeTotals(db: Database, scope: TimeScope): Promise<ScopeTimeTotals> {
  switch (scope.scope) {
    case "project":
      return timeRepository.sumTimeForProject(db, scope.id, scope.period);
    case "client":
      return timeRepository.sumTimeForCompany(db, scope.id, scope.period);
    case "contract":
      return timeRepository.sumTimeForContract(db, scope.id, scope.period);
    case "site":
      return timeRepository.sumTimeForSite(db, scope.id, scope.period);
  }
}

/** Coût du temps d'une portée, en centimes : la seule entrée de temps de `getMargin`. */
export async function getTimeCostCents(db: Database, scope: TimeScope): Promise<number> {
  return (await getTimeTotals(db, scope)).costCents;
}

// --- Accès ---------------------------------------------------------------------------------------

export interface TimeAccess {
  /** Voit le temps et la capacité de toute l'équipe. */
  canReadAll: boolean;
  /** Saisit et modifie pour tout le monde. */
  canManage: boolean;
  /** Saisit son propre temps. */
  canCreateOwn: boolean;
  canReadCosts: boolean;
  ownMemberId: string | null;
}

export async function getTimeAccess(ctx: ServiceContext): Promise<TimeAccess> {
  assertCanAny(ctx.actor, ["time:read", "time:create_own", "time:manage"]);
  return {
    canReadAll: can(ctx.actor, "time:read"),
    canManage: can(ctx.actor, "time:manage"),
    canCreateOwn: can(ctx.actor, "time:create_own"),
    canReadCosts: can(ctx.actor, "team:read_costs"),
    ownMemberId: await getMemberIdForUser(ctx.db, ctx.actor.userId),
  };
}

// --- Vues : le coût figé ne sort qu'avec `team:read_costs` ---------------------------------------

export type TimeEntryView = Omit<timeRepository.TimeEntryRow, "hourlyCostCents"> & {
  /** Absent sans `team:read_costs`. */
  hourlyCostCents?: number;
  costCents?: number;
};

function toView(ctx: ServiceContext, row: timeRepository.TimeEntryRow): TimeEntryView {
  const { hourlyCostCents, ...rest } = row;
  if (!can(ctx.actor, "team:read_costs")) return rest;
  return {
    ...rest,
    hourlyCostCents,
    costCents: Math.round((row.minutes * hourlyCostCents) / 60),
  };
}

// --- Rattachement d'une saisie -------------------------------------------------------------------

interface WorkInput {
  projectId?: string;
  taskId?: string;
  ticketId?: string;
  contractId?: string;
  category: TimeCategory;
  billable?: boolean;
}

interface ResolvedWork {
  companyId: string | null;
  projectId: string | null;
  taskId: string | null;
  ticketId: string | null;
  contractId: string | null;
  category: TimeCategory;
  billable: boolean;
}

/** Un prestataire n'a ni `projects:read` ni `time:read` : la permission ne suffit pas. */
function isScopedToAssignedWork(ctx: ServiceContext): boolean {
  return !can(ctx.actor, "projects:read");
}

async function resolveWork(
  tx: Database,
  ctx: ServiceContext,
  memberId: string,
  input: WorkInput,
): Promise<ResolvedWork> {
  const scoped = isScopedToAssignedWork(ctx);

  const ticket = input.ticketId ? await timeRepository.getTicketLink(tx, input.ticketId) : null;
  if (input.ticketId && !ticket) throw new NotFoundError("Demande introuvable.");
  if (ticket && scoped && !(await timeRepository.isTicketAssignedToMember(tx, memberId, ticket))) {
    throw new NotFoundError("Demande introuvable.");
  }

  const task = input.taskId ? await timeRepository.getTaskLink(tx, input.taskId) : null;
  if (input.taskId && !task) throw new NotFoundError("Tâche introuvable.");
  if (task && scoped && !(await timeRepository.isTaskAssignedToMember(tx, memberId, task))) {
    throw new NotFoundError("Tâche introuvable.");
  }
  if (task && input.projectId && task.projectId !== input.projectId) {
    throw new ConflictError("Cette tâche n'appartient pas à ce projet.", {
      taskId: ["Cette tâche n'appartient pas à ce projet."],
    });
  }

  // Le projet explicite doit être attribué ; celui hérité d'une tâche ou d'une demande attribuée, déjà contrôlée, l'est de fait.
  const project = input.projectId ? await timeRepository.getProjectLink(tx, input.projectId) : null;
  if (input.projectId && !project) throw new NotFoundError("Projet introuvable.");
  if (project && scoped && !(await isAssignedToProject(tx, ctx.actor, project.id))) {
    throw new NotFoundError("Projet introuvable.");
  }

  const contract = input.contractId
    ? await timeRepository.getContractLink(tx, input.contractId)
    : null;
  if (input.contractId && !contract) throw new NotFoundError("Contrat introuvable.");
  if (
    contract &&
    scoped &&
    !(await timeRepository.isContractAssignedToMember(tx, memberId, contract.id))
  ) {
    throw new NotFoundError("Contrat introuvable.");
  }

  const projectId = project?.id ?? task?.projectId ?? ticket?.projectId ?? null;
  const contractId = contract?.id ?? ticket?.contractId ?? null;
  const companies = new Set(
    [project?.companyId, task?.companyId, ticket?.companyId, contract?.companyId].filter(
      (value): value is string => Boolean(value),
    ),
  );
  if (companies.size > 1) {
    throw new ConflictError("Ces éléments n'appartiennent pas au même client.", {
      projectId: ["Choisissez des éléments du même client."],
    });
  }
  const [companyId = null] = companies;

  if (!companyId && !NO_ATTACHMENT_CATEGORIES.includes(input.category)) {
    throw new ValidationError("Rattachez ce temps à un projet, une demande ou un contrat.", {
      projectId: ["Rattachez ce temps à un projet, une demande ou un contrat."],
    });
  }
  if (!companyId && scoped) {
    throw new ValidationError("Votre temps se saisit sur un travail qui vous est attribué.", {
      projectId: ["Choisissez un travail qui vous est attribué."],
    });
  }

  return {
    companyId,
    projectId,
    taskId: task?.id ?? null,
    ticketId: ticket?.id ?? null,
    contractId,
    category: input.category,
    billable: input.billable ?? !NO_ATTACHMENT_CATEGORIES.includes(input.category),
  };
}

/** Membre de la saisie : le sien, ou n'importe lequel avec `time:manage`. Actif et non archivé. */
async function resolveEntryMember(tx: Database, ctx: ServiceContext, memberId?: string) {
  const own = await getMemberIdForUser(tx, ctx.actor.userId);
  const targetId = memberId ?? own;
  if (!targetId) {
    throw new ConflictError(
      "Aucune fiche d'équipe n'est rattachée à votre compte : un compte Associé doit la relier.",
    );
  }
  if (targetId !== own && !can(ctx.actor, "time:manage")) {
    throw new ForbiddenError("Vous ne pouvez saisir que votre propre temps.");
  }
  if (targetId === own && !can(ctx.actor, "time:create_own") && !can(ctx.actor, "time:manage")) {
    throw new ForbiddenError();
  }
  const member = await timeRepository.getMemberForEntry(tx, targetId);
  if (!member) throw new NotFoundError("Membre introuvable.");
  if (member.archivedAt || member.status !== "active") {
    throw new ConflictError("Ce membre n'est plus actif : son temps ne peut plus être saisi.");
  }
  return member;
}

function assertNotFuture(workOn: string): void {
  if (workOn > parisToday()) {
    throw new ValidationError("Le temps passé ne se saisit pas à l'avance.", {
      workOn: ["Choisissez aujourd'hui ou une date passée."],
    });
  }
}

async function assertDayLimit(
  tx: Database,
  memberId: string,
  workOn: string,
  minutes: number,
  excludingIds: readonly string[] = [],
): Promise<void> {
  const others = await timeRepository.sumMemberDay(tx, memberId, workOn, excludingIds);
  if (others + minutes > MAX_MINUTES_PER_DAY) {
    throw new ValidationError("Une journée ne dépasse pas 24 h.", {
      minutes: ["Une journée ne dépasse pas 24 h."],
    });
  }
}

/** Émis une fois par projet : la clé de déduplication évite de répéter l'alerte (parcours 5). */
async function emitBudgetThreshold(
  tx: Database,
  ctx: ServiceContext,
  projectId: string | null,
  companyId: string | null,
): Promise<void> {
  if (!projectId) return;
  const envelope = await timeRepository.getProjectEnvelope(tx, projectId);
  if (!envelope?.budgetCents || envelope.budgetCents <= 0) return;
  const { costCents } = await timeRepository.sumTimeForProject(tx, projectId);
  if (costCents * 100 < envelope.budgetCents * BUDGET_ALERT_PERCENT) return;
  await emitEvent(tx, {
    type: "budget.threshold_80",
    entityType: "project",
    entityId: projectId,
    companyId,
    payload: { consumedCents: costCents, budgetCents: envelope.budgetCents },
    actorId: ctx.actor.userId,
    dedupeKey: `budget.threshold_80:${projectId}`,
  });
}

// --- Écritures -----------------------------------------------------------------------------------

/**
 * Enregistre une saisie, au coût horaire du membre à cet instant. Un second envoi identique dans les
 * 10 secondes renvoie la saisie déjà créée. Le forfait d'un contrat n'est pas touché : sa consommation
 * vient des interventions réalisées (lot Contrats).
 */
export async function createTimeEntry(
  ctx: ServiceContext,
  input: unknown,
): Promise<{ id: string; created: boolean }> {
  assertCanAny(ctx.actor, ["time:create_own", "time:manage"]);
  const data = parseInput(timeEntrySchema, input);
  assertNotFuture(data.workOn);

  return ctx.db.transaction(async (tx) => {
    const member = await resolveEntryMember(tx, ctx, data.memberId);
    const work = await resolveWork(tx, ctx, member.id, data);
    await lockMemberDay(tx, member.id, data.workOn);

    const duplicate = await timeRepository.findRecentDuplicate(
      tx,
      {
        ...work,
        memberId: member.id,
        workOn: data.workOn,
        minutes: data.minutes,
        note: data.note ?? null,
        createdBy: ctx.actor.userId,
      },
      new Date(Date.now() - DUPLICATE_WINDOW_MS),
    );
    if (duplicate) return { id: duplicate, created: false };

    await assertDayLimit(tx, member.id, data.workOn, data.minutes);
    const row = await timeRepository.insertEntry(tx, {
      ...work,
      memberId: member.id,
      workOn: data.workOn,
      minutes: data.minutes,
      note: data.note ?? null,
      hourlyCostCents: member.hourlyCostCents ?? 0,
      createdBy: ctx.actor.userId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "time_entry.created",
      entityType: "time_entry",
      entityId: row.id,
      metadata: {
        memberId: member.id,
        workOn: data.workOn,
        minutes: data.minutes,
        category: work.category,
        projectId: work.projectId,
        ticketId: work.ticketId,
        contractId: work.contractId,
      },
    });
    await emitBudgetThreshold(tx, ctx, work.projectId, work.companyId);
    return { id: row.id, created: true };
  });
}

/** Saisie modifiable par l'acteur : la sienne tant que sa fiche est active, ou toutes avec `time:manage`. */
async function loadEditableEntry(tx: Database, ctx: ServiceContext, id: string) {
  const entry = await timeRepository.getEntry(tx, id);
  if (!entry) throw new NotFoundError("Saisie introuvable.");
  if (can(ctx.actor, "time:manage")) return entry;
  const own = await getMemberIdForUser(tx, ctx.actor.userId);
  if (entry.memberId === own) {
    const member = await timeRepository.getMemberForEntry(tx, entry.memberId);
    if (!member || member.archivedAt || member.status !== "active") {
      throw new ConflictError("Votre fiche n'est plus active : ce temps ne se modifie plus.");
    }
    return entry;
  }
  // Un prestataire ne sait pas que cette saisie existe.
  if (!can(ctx.actor, "time:read")) throw new NotFoundError("Saisie introuvable.");
  throw new ForbiddenError("Vous ne pouvez modifier que votre propre temps.");
}

/** Le coût reste celui figé à la saisie, sauf si le temps change de membre. */
export async function updateTimeEntry(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<{ id: string; changed: boolean }> {
  assertCanAny(ctx.actor, ["time:create_own", "time:manage"]);
  const data = parseInput(timeEntrySchema, input);
  assertNotFuture(data.workOn);
  if (!isUuid(id)) throw new NotFoundError("Saisie introuvable.");

  return ctx.db.transaction(async (tx) => {
    const entry = await loadEditableEntry(tx, ctx, id);
    const memberId = data.memberId ?? entry.memberId;
    const member =
      memberId === entry.memberId
        ? await timeRepository.getMemberForEntry(tx, memberId)
        : await resolveEntryMember(tx, ctx, memberId);
    if (!member) throw new NotFoundError("Membre introuvable.");

    const work = await resolveWork(tx, ctx, member.id, data);
    await lockMemberDay(tx, member.id, data.workOn);
    const note = data.note ?? null;
    const same =
      memberId === entry.memberId &&
      data.workOn === entry.workOn &&
      data.minutes === entry.minutes &&
      note === entry.note &&
      work.category === entry.category &&
      work.billable === entry.billable &&
      work.projectId === entry.projectId &&
      work.taskId === entry.taskId &&
      work.ticketId === entry.ticketId &&
      work.contractId === entry.contractId;
    if (same) return { id, changed: false };

    await assertDayLimit(tx, member.id, data.workOn, data.minutes, [id]);
    await timeRepository.updateEntry(tx, id, {
      ...work,
      memberId: member.id,
      workOn: data.workOn,
      minutes: data.minutes,
      note,
      hourlyCostCents:
        memberId === entry.memberId ? entry.hourlyCostCents : (member.hourlyCostCents ?? 0),
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "time_entry.updated",
      entityType: "time_entry",
      entityId: id,
      metadata: {
        memberId: member.id,
        workOn: data.workOn,
        fromMinutes: entry.minutes,
        toMinutes: data.minutes,
        category: work.category,
        projectId: work.projectId,
      },
    });
    await emitBudgetThreshold(tx, ctx, work.projectId, work.companyId);
    return { id, changed: true };
  });
}

/** Déjà supprimée : aucune erreur, rien de plus au journal. */
export async function deleteTimeEntry(ctx: ServiceContext, id: string): Promise<void> {
  assertCanAny(ctx.actor, ["time:create_own", "time:manage"]);
  if (!isUuid(id)) return;
  await ctx.db.transaction(async (tx) => {
    const existing = await timeRepository.getEntry(tx, id);
    if (!existing) return;
    const entry = await loadEditableEntry(tx, ctx, id);
    await timeRepository.deleteEntry(tx, id);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "time_entry.deleted",
      entityType: "time_entry",
      entityId: id,
      metadata: {
        memberId: entry.memberId,
        workOn: entry.workOn,
        minutes: entry.minutes,
        category: entry.category,
        projectId: entry.projectId,
        ticketId: entry.ticketId,
        contractId: entry.contractId,
      },
    });
  });
}

/**
 * Enregistre le total voulu d'une cellule de feuille de temps : renvoyer deux fois la même valeur ne
 * change rien, et deux enregistrements simultanés passent l'un après l'autre. Le temps ajouté rejoint
 * la dernière saisie si elle a le même coût figé, sinon il devient une saisie au coût du jour.
 */
export async function saveTimesheetCell(
  ctx: ServiceContext,
  input: unknown,
): Promise<{ minutes: number; changed: boolean }> {
  assertCanAny(ctx.actor, ["time:create_own", "time:manage"]);
  const data = parseInput(timesheetCellSchema, input);
  assertNotFuture(data.workOn);

  return ctx.db.transaction(async (tx) => {
    const member = await resolveEntryMember(tx, ctx, data.memberId);
    const work = await resolveWork(tx, ctx, member.id, data);
    const identity = { ...work, memberId: member.id, workOn: data.workOn };
    await lockMemberDay(tx, member.id, data.workOn);

    const entries = await timeRepository.listCellEntries(tx, identity);
    const current = entries.reduce((sum, entry) => sum + entry.minutes, 0);
    if (current === data.minutes) return { minutes: current, changed: false };

    await assertDayLimit(
      tx,
      member.id,
      data.workOn,
      data.minutes,
      entries.map((entry) => entry.id),
    );

    const frozen = member.hourlyCostCents ?? 0;
    let touchedId = entries[entries.length - 1]?.id ?? null;

    if (data.minutes > current) {
      const delta = data.minutes - current;
      const last = entries[entries.length - 1];
      if (last && last.hourlyCostCents === frozen) {
        await timeRepository.updateEntry(tx, last.id, { minutes: last.minutes + delta });
      } else {
        const row = await timeRepository.insertEntry(tx, {
          ...identity,
          minutes: delta,
          hourlyCostCents: frozen,
          createdBy: ctx.actor.userId,
        });
        touchedId = row.id;
      }
    } else {
      let left = current - data.minutes;
      for (const entry of [...entries].reverse()) {
        if (left <= 0) break;
        if (entry.minutes <= left) {
          await timeRepository.deleteEntry(tx, entry.id);
          left -= entry.minutes;
        } else {
          await timeRepository.updateEntry(tx, entry.id, { minutes: entry.minutes - left });
          left = 0;
        }
      }
    }

    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action:
        current === 0
          ? "time_entry.created"
          : data.minutes === 0
            ? "time_entry.deleted"
            : "time_entry.updated",
      entityType: "time_entry",
      entityId: touchedId ?? undefined,
      metadata: {
        via: "timesheet",
        memberId: member.id,
        workOn: data.workOn,
        fromMinutes: current,
        toMinutes: data.minutes,
        category: work.category,
        projectId: work.projectId,
      },
    });
    await emitBudgetThreshold(tx, ctx, work.projectId, work.companyId);
    return { minutes: data.minutes, changed: true };
  });
}

// --- Lectures de l'écran ---------------------------------------------------------------------------

export interface TimeEntryListFilters {
  memberId?: string;
  projectId?: string;
  category?: TimeCategory;
  billable?: boolean;
  from?: string;
  to?: string;
  search?: string;
}

/** Un prestataire ne voit que son temps, quel que soit le filtre demandé : le périmètre est dans la requête. */
export async function listTimeEntries(
  ctx: ServiceContext,
  filters: TimeEntryListFilters,
  params: PageParams,
): Promise<Paginated<TimeEntryView>> {
  const access = await getTimeAccess(ctx);
  if (!access.canReadAll && !access.ownMemberId) return paginated([], 0, params);
  if (filters.memberId && !isUuid(filters.memberId)) return paginated([], 0, params);
  const scoped: timeRepository.TimeEntryFilters = access.canReadAll
    ? filters
    : { ...filters, memberId: access.ownMemberId ?? undefined };
  const [rows, total] = await Promise.all([
    timeRepository.listEntries(ctx.db, scoped, params.pageSize, pageOffset(params)),
    timeRepository.countEntries(ctx.db, scoped),
  ]);
  return paginated(
    rows.map((row) => toView(ctx, row)),
    total,
    params,
  );
}

export async function getTimeEntry(ctx: ServiceContext, id: string): Promise<TimeEntryView> {
  const access = await getTimeAccess(ctx);
  if (!isUuid(id)) throw new NotFoundError("Saisie introuvable.");
  const entry = await timeRepository.getEntry(ctx.db, id);
  if (!entry || (!access.canReadAll && entry.memberId !== access.ownMemberId)) {
    throw new NotFoundError("Saisie introuvable.");
  }
  return toView(ctx, entry);
}

export interface CompanyTimeRow {
  id: string;
  workOn: string;
  memberName: string;
  minutes: number;
  category: TimeCategory;
  billable: boolean;
  projectName: string | null;
  label: string;
  /** Absent sans `team:read_costs`. */
  costCents?: number;
}

/** Fiche client 360° : dernières saisies du client, sans coût sauf `team:read_costs`. */
export async function listTimeEntriesForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<CompanyTimeRow[]> {
  assertCan(ctx.actor, "time:read");
  if (!isUuid(companyId)) return [];
  const rows = await timeRepository.listEntries(
    ctx.db,
    { companyId },
    Math.min(options.limit ?? 10, 100),
    0,
  );
  return rows.map((row) => {
    const view = toView(ctx, row);
    return {
      id: row.id,
      workOn: row.workOn,
      memberName: row.memberName,
      minutes: row.minutes,
      category: row.category,
      billable: row.billable,
      projectName: row.projectName,
      label: entryWorkLabel(row),
      ...(view.costCents === undefined ? {} : { costCents: view.costCents }),
    };
  });
}

/** Ce sur quoi porte une saisie, en une ligne. */
export function entryWorkLabel(
  row: Pick<
    timeRepository.TimeEntryRow,
    | "companyName"
    | "projectName"
    | "taskTitle"
    | "ticketNumber"
    | "ticketSubject"
    | "contractName"
    | "category"
  >,
): string {
  const detail =
    row.taskTitle ??
    (row.ticketNumber ? `${row.ticketNumber} · ${row.ticketSubject}` : null) ??
    row.projectName ??
    row.contractName;
  if (row.companyName && detail) return `${row.companyName} · ${detail}`;
  return row.companyName ?? detail ?? TIME_CATEGORY_LABELS[row.category];
}

// --- Feuille de temps ------------------------------------------------------------------------------

export interface TimesheetRow {
  key: string;
  label: string;
  detail: string | null;
  projectId: string | null;
  taskId: string | null;
  ticketId: string | null;
  contractId: string | null;
  category: TimeCategory;
  billable: boolean;
  /** Minutes par jour `AAAA-MM-JJ`. */
  cells: Record<string, number>;
  totalMinutes: number;
}

export interface Timesheet {
  member: { id: string; fullName: string } | null;
  week: {
    key: string;
    label: string;
    start: string;
    end: string;
    previousKey: string;
    nextKey: string;
    isCurrent: boolean;
  };
  today: string;
  /** Jours affichés : du lundi au vendredi, plus le week-end s'il porte du temps. */
  days: string[];
  rows: TimesheetRow[];
  totalMinutes: number;
  editable: boolean;
}

function rowKey(row: {
  projectId: string | null;
  taskId: string | null;
  ticketId: string | null;
  contractId: string | null;
  category: string;
  billable: boolean;
}): string {
  return [
    row.projectId ?? "",
    row.taskId ?? "",
    row.ticketId ?? "",
    row.contractId ?? "",
    row.category,
    row.billable ? "1" : "0",
  ].join("|");
}

function rowLabel(companyName: string | null, category: TimeCategory): string {
  const label = TIME_CATEGORY_LABELS[category];
  return companyName ? `${companyName} · ${label.toLocaleLowerCase("fr-FR")}` : label;
}

/**
 * Feuille d'un membre pour une semaine. `memberId` absent : la sienne. Le temps d'un autre membre
 * exige `time:read` et reste en lecture seule sans `time:manage`.
 */
export async function getTimesheet(
  ctx: ServiceContext,
  options: { memberId?: string; weekOf: string },
): Promise<Timesheet> {
  const access = await getTimeAccess(ctx);
  const targetId = options.memberId ?? access.ownMemberId;
  const today = parisToday();
  const monday = weekStart(options.weekOf);
  const sunday = weekEnd(monday);
  const week: Timesheet["week"] = {
    key: weekKey(monday),
    label: `Semaine ${weekLabel(monday).slice(1)}`,
    start: monday,
    end: sunday,
    previousKey: weekKey(addDays(monday, -7)),
    nextKey: weekKey(addDays(monday, 7)),
    isCurrent: weekStart(today) === monday,
  };
  const weekdays = eachDay(monday, addDays(monday, 4));

  if (!targetId) {
    return {
      member: null,
      week,
      today,
      days: weekdays,
      rows: [],
      totalMinutes: 0,
      editable: false,
    };
  }
  if (!isUuid(targetId) || (targetId !== access.ownMemberId && !access.canReadAll)) {
    throw new NotFoundError("Membre introuvable.");
  }

  const member = await timeRepository.getMemberForEntry(ctx.db, targetId);
  if (!member) throw new NotFoundError("Membre introuvable.");

  const active = !member.archivedAt && member.status === "active";
  const editable =
    active && (access.canManage || (targetId === access.ownMemberId && access.canCreateOwn));

  const entries = await timeRepository.listMemberEntriesBetween(ctx.db, targetId, {
    from: monday,
    to: sunday,
  });

  const rows = new Map<string, TimesheetRow>();
  const ensure = (seed: Omit<TimesheetRow, "key" | "cells" | "totalMinutes">): TimesheetRow => {
    const key = rowKey(seed);
    let row = rows.get(key);
    if (!row) {
      row = { ...seed, key, cells: {}, totalMinutes: 0 };
      rows.set(key, row);
    }
    return row;
  };

  for (const entry of entries) {
    const detail =
      entry.taskTitle ??
      (entry.ticketNumber ? `${entry.ticketNumber} · ${entry.ticketSubject}` : null) ??
      (entry.projectId ? null : entry.contractName);
    const row = ensure({
      label: rowLabel(entry.companyName, entry.category),
      detail,
      projectId: entry.projectId,
      taskId: entry.taskId,
      ticketId: entry.ticketId,
      contractId: entry.contractId,
      category: entry.category,
      billable: entry.billable,
    });
    row.cells[entry.workOn] = (row.cells[entry.workOn] ?? 0) + entry.minutes;
    row.totalMinutes += entry.minutes;
  }

  if (editable) {
    const projects = await timeRepository.listMemberOpenProjects(ctx.db, targetId);
    for (const project of projects) {
      ensure({
        label: rowLabel(project.companyName, "production"),
        detail: null,
        projectId: project.projectId,
        taskId: null,
        ticketId: null,
        contractId: null,
        category: "production",
        billable: true,
      });
    }
    if (member.kind !== "contractor") {
      for (const category of NO_ATTACHMENT_CATEGORIES) {
        ensure({
          label: TIME_CATEGORY_LABELS[category],
          detail: null,
          projectId: null,
          taskId: null,
          ticketId: null,
          contractId: null,
          category,
          billable: false,
        });
      }
    }
  }

  // Deux lignes au même libellé (deux projets d'un client) : le nom du projet les distingue.
  const projectNames = new Map(
    entries.flatMap((entry) =>
      entry.projectId && entry.projectName ? [[entry.projectId, entry.projectName]] : [],
    ) as [string, string][],
  );
  if (editable) {
    for (const project of await timeRepository.listMemberOpenProjects(ctx.db, targetId)) {
      projectNames.set(project.projectId, project.projectName);
    }
  }
  const labelCounts = new Map<string, number>();
  for (const row of rows.values()) {
    labelCounts.set(row.label, (labelCounts.get(row.label) ?? 0) + 1);
  }
  const ordered = [...rows.values()]
    .map((row) => {
      const shared = (labelCounts.get(row.label) ?? 0) > 1;
      const projectName = row.projectId ? projectNames.get(row.projectId) : undefined;
      const parts = [
        row.detail ?? (shared ? projectName : null),
        !row.billable && !NO_ATTACHMENT_CATEGORIES.includes(row.category) ? "non facturable" : null,
      ].filter(Boolean);
      return { ...row, detail: parts.length > 0 ? parts.join(" · ") : null };
    })
    .sort((a, b) => {
      const rank = (row: TimesheetRow) =>
        row.category === "prospecting" ? 2 : row.category === "admin" ? 3 : row.projectId ? 0 : 1;
      return rank(a) - rank(b) || a.label.localeCompare(b.label, "fr");
    });

  const days = [
    ...weekdays,
    ...eachDay(addDays(monday, 5), sunday).filter((day) =>
      entries.some((entry) => entry.workOn === day),
    ),
  ];

  return {
    member: { id: member.id, fullName: member.fullName },
    week,
    today,
    days,
    rows: ordered,
    totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
    editable,
  };
}

export interface TimeEntryOptions {
  projects: timeRepository.WorkOption[];
  tickets: timeRepository.WorkOption[];
  contracts: timeRepository.WorkOption[];
  /** Vide sans `time:manage` : on ne saisit alors que pour soi. */
  members: { id: string; fullName: string }[];
  ownMemberId: string | null;
}

/** Choix du formulaire de saisie : un prestataire ne voit que le travail qui lui est attribué. */
export async function getTimeEntryOptions(ctx: ServiceContext): Promise<TimeEntryOptions> {
  const access = await getTimeAccess(ctx);
  const scoped = isScopedToAssignedWork(ctx);
  const memberId = scoped ? (access.ownMemberId ?? undefined) : undefined;
  if (scoped && !memberId) {
    return { projects: [], tickets: [], contracts: [], members: [], ownMemberId: null };
  }
  const assignedProjects = scoped ? await getAssignedProjectIds(ctx.db, ctx.actor) : undefined;
  const [projects, tickets, contracts, members] = await Promise.all([
    timeRepository.listProjectOptions(ctx.db, { projectIds: assignedProjects }),
    timeRepository.listTicketOptions(ctx.db, { memberId }),
    timeRepository.listContractOptions(ctx.db, { memberId }),
    access.canManage ? timeRepository.listSheetMembers(ctx.db) : Promise.resolve([]),
  ]);
  return {
    projects,
    tickets,
    contracts,
    members: members.map((member) => ({ id: member.id, fullName: member.fullName })),
    ownMemberId: access.ownMemberId,
  };
}

/** Tâches ouvertes d'un projet, pour le formulaire de saisie. Hors périmètre : 404. */
export async function listTaskOptionsForProject(
  ctx: ServiceContext,
  projectId: string,
): Promise<{ id: string; label: string }[]> {
  const access = await getTimeAccess(ctx);
  if (!isUuid(projectId)) throw new NotFoundError("Projet introuvable.");
  if (!isScopedToAssignedWork(ctx)) return timeRepository.listTaskOptions(ctx.db, projectId);
  if (!access.ownMemberId || !(await isAssignedToProject(ctx.db, ctx.actor, projectId))) {
    throw new NotFoundError("Projet introuvable.");
  }
  return timeRepository.listTaskOptions(ctx.db, projectId, { memberId: access.ownMemberId });
}

/** Membres dont l'acteur peut ouvrir la feuille de temps. */
export async function listTimesheetMembers(
  ctx: ServiceContext,
): Promise<{ id: string; fullName: string }[]> {
  assertCan(ctx.actor, "time:read");
  const rows = await timeRepository.listSheetMembers(ctx.db);
  return rows.map((row) => ({ id: row.id, fullName: row.fullName }));
}

// --- Écran 18 --------------------------------------------------------------------------------------

export interface CategoryShare {
  category: TimeCategory;
  label: string;
  minutes: number;
  percent: number;
}

export interface ProductivityRow {
  activity: string;
  projects: number;
  soldMinutes: number;
  actualMinutes: number;
}

export interface OverrunRow {
  id: string;
  kind: "project" | "task";
  label: string;
  detail: string;
  href: string;
  /** `null` : pas d'estimation, seul le budget déclenche la ligne. */
  estimatedMinutes: number | null;
  minutes: number;
  /** La plus forte consommation : temps sur estimation, ou coût sur budget avec `team:read_costs`. */
  percent: number;
  /** Absent sans `team:read_costs`. */
  costCents?: number;
  budgetCents?: number | null;
}

export interface TimeOverview {
  week: {
    totalMinutes: number;
    byMember: { memberId: string; fullName: string; minutes: number }[];
  };
  month: { from: string; to: string; totalMinutes: number };
  /** Part du temps non facturable du mois ; `null` sans temps saisi. */
  nonBillable: { percent: number | null; categories: string[] };
  categories: CategoryShare[];
  /** Le reste est réservé à `time:read`. */
  capacity: CapacityOverview | null;
  sixWeeks: WeekLoad[] | null;
  /** Écart moyen à l'estimation sur le travail terminé ; `null` sans point de comparaison. */
  plannedVsActualPercent: number | null;
  productivity: ProductivityRow[] | null;
  overruns: OverrunRow[] | null;
}

/**
 * Données de l'écran 18. Toute l'équipe avec `time:read` ; sinon, le temps de l'acteur seulement et
 * rien sur la capacité de l'agence.
 */
export async function getTimeOverview(
  ctx: ServiceContext,
  options: { weekOf: string },
): Promise<TimeOverview> {
  const access = await getTimeAccess(ctx);
  const monday = weekStart(options.weekOf);
  const scopeMember = access.canReadAll ? undefined : (access.ownMemberId ?? "none");
  const month = monthRange(monday);

  if (scopeMember === "none") {
    return {
      week: { totalMinutes: 0, byMember: [] },
      month: { ...month, totalMinutes: 0 },
      nonBillable: { percent: null, categories: [] },
      categories: [],
      capacity: null,
      sixWeeks: null,
      plannedVsActualPercent: null,
      productivity: null,
      overruns: null,
    };
  }

  const [byMember, categoryRows] = await Promise.all([
    timeRepository.sumWeekByMember(ctx.db, { from: monday, to: weekEnd(monday) }, scopeMember),
    timeRepository.sumByCategory(ctx.db, month, scopeMember),
  ]);

  const monthTotal = categoryRows.reduce((sum, row) => sum + row.minutes, 0);
  const nonBillableTotal = categoryRows.reduce((sum, row) => sum + row.nonBillableMinutes, 0);
  const categories: CategoryShare[] = categoryRows
    .map((row) => ({
      category: row.category,
      label: TIME_CATEGORY_LABELS[row.category],
      minutes: row.minutes,
      percent: monthTotal > 0 ? Math.round((row.minutes / monthTotal) * 100) : 0,
    }))
    .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category));

  const base = {
    week: {
      totalMinutes: byMember.reduce((sum, row) => sum + row.minutes, 0),
      byMember,
    },
    month: { ...month, totalMinutes: monthTotal },
    nonBillable: {
      percent: monthTotal > 0 ? Math.round((nonBillableTotal / monthTotal) * 100) : null,
      categories: categoryRows
        .filter((row) => row.nonBillableMinutes > 0)
        .sort((a, b) => b.nonBillableMinutes - a.nonBillableMinutes)
        .map((row) => TIME_CATEGORY_LABELS[row.category].toLocaleLowerCase("fr-FR")),
    },
    categories,
  };

  if (!access.canReadAll) {
    return {
      ...base,
      capacity: null,
      sixWeeks: null,
      plannedVsActualPercent: null,
      productivity: null,
      overruns: null,
    };
  }

  const [capacity, sixWeeks, comparisons, productivity, overruns] = await Promise.all([
    getCapacityOverview(ctx.db, monthRange(parisToday())),
    getSixWeekLoad(ctx.db),
    timeRepository.listEstimateComparisons(ctx.db),
    timeRepository.listActivityProductivity(ctx.db),
    timeRepository.listOverruns(ctx.db, BUDGET_ALERT_PERCENT, { byBudget: access.canReadCosts }),
  ]);

  const estimated = comparisons.reduce((sum, row) => sum + row.estimated, 0);
  const actual = comparisons.reduce((sum, row) => sum + row.actual, 0);

  const overrunRows: OverrunRow[] = [
    ...overruns.projects.map((row): OverrunRow => {
      const minutesPercent = row.estimatedMinutes
        ? Math.round((row.minutes / row.estimatedMinutes) * 100)
        : 0;
      const budgetPercent =
        access.canReadCosts && row.budgetCents
          ? Math.round((Number(row.costCents) / row.budgetCents) * 100)
          : 0;
      return {
        id: row.id,
        kind: "project",
        label: row.name,
        detail: row.companyName,
        href: `/projets/${row.id}`,
        estimatedMinutes: row.estimatedMinutes || null,
        minutes: row.minutes,
        percent: Math.max(minutesPercent, budgetPercent),
        ...(access.canReadCosts
          ? { costCents: Number(row.costCents), budgetCents: row.budgetCents }
          : {}),
      };
    }),
    ...overruns.tasks.map((row): OverrunRow => {
      const estimatedMinutes = row.estimatedMinutes ?? 0;
      return {
        id: row.id,
        kind: "task",
        label: row.title,
        detail: row.projectName,
        href: `/projets/${row.projectId}`,
        estimatedMinutes,
        minutes: row.minutes,
        percent: Math.round((row.minutes / estimatedMinutes) * 100),
      };
    }),
  ].sort((a, b) => b.percent - a.percent);

  return {
    ...base,
    capacity,
    sixWeeks,
    plannedVsActualPercent:
      estimated > 0 ? Math.round(((actual - estimated) / estimated) * 100) : null,
    productivity,
    overruns: overrunRows,
  };
}

function categoryOrder(category: TimeCategory): number {
  return ["production", "corrections", "support", "prospecting", "admin"].indexOf(category);
}

/** Projets et demandes ouverts, pour les listes de choix d'un autre service du lot (sans contrôle d'accès). */
export async function getWorkOptions(db: Database) {
  const [projects, tickets] = await Promise.all([
    timeRepository.listProjectOptions(db),
    timeRepository.listTicketOptions(db),
  ]);
  return { projects, tickets };
}

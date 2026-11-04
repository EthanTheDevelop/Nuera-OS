import { MINUTES_PER_DAY } from "@/lib/format";
import { z } from "@/lib/zod";

/**
 * Règles pures du domaine Projets, sans base ni session : testées seules, utilisables à l'écran.
 * Les dates métier sont des chaînes `AAAA-MM-JJ` ; « aujourd'hui » est le jour civil à Paris.
 */

/** Jalons standard d'un projet sans modèle de plan pour son activité (spec 05.02.01). */
export const STANDARD_MILESTONES = [
  "Cadrage",
  "Design",
  "Développement",
  "Recette",
  "Mise en ligne",
] as const;

/** Arbitrage A7 : alerte de consommation de budget. */
export const BUDGET_ALERT_PERCENT = 80;

export function parisDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function dayToUtc(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

const DAY_MS = 86_400_000;

export function addDays(day: string, days: number): string {
  return new Date(dayToUtc(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Jours entre deux dates (`to − from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayToUtc(to) - dayToUtc(from)) / DAY_MS);
}

/** Lundi de la semaine d'une date. */
export function mondayOf(day: string): string {
  const weekday = new Date(dayToUtc(day)).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/** Numéro de semaine ISO 8601. */
export function isoWeekNumber(day: string): number {
  const thursday = addDays(mondayOf(day), 3);
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(daysBetween(yearStart, thursday) / 7) + 1;
}

/** Lundis des `count` semaines à partir de celle de `day`. */
export function nextWeeks(day: string, count: number): string[] {
  const first = mondayOf(day);
  return Array.from({ length: count }, (_, index) => addDays(first, index * 7));
}

export function minutesToDays(minutes: number): number {
  return Math.round((minutes / MINUTES_PER_DAY) * 10) / 10;
}

// --- Avancement --------------------------------------------------------------------------------

export interface TaskTotals {
  taskCount: number;
  doneCount: number;
  estimatedMinutes: number;
  doneMinutes: number;
}

export const EMPTY_TASK_TOTALS: TaskTotals = {
  taskCount: 0,
  doneCount: 0,
  estimatedMinutes: 0,
  doneMinutes: 0,
};

export interface ProjectProgress {
  /** De 0 à 100. */
  percent: number;
  /** `minutes` : journées prévues comme référence. `tasks` : aucune estimation, on compte. */
  unit: "minutes" | "tasks";
  done: number;
  total: number;
}

/**
 * Fait et reste à faire. Avec des estimations : temps estimé des tâches faites sur l'enveloppe
 * (vendue si elle est connue). Sans estimation : nombre de tâches.
 */
export function projectProgress(
  totals: TaskTotals,
  soldMinutes: number | null | undefined,
): ProjectProgress {
  const totalMinutes = soldMinutes && soldMinutes > 0 ? soldMinutes : totals.estimatedMinutes;
  if (totals.estimatedMinutes > 0 && totalMinutes > 0) {
    return {
      percent: Math.min(100, Math.round((totals.doneMinutes / totalMinutes) * 100)),
      unit: "minutes",
      done: totals.doneMinutes,
      total: totalMinutes,
    };
  }
  if (totals.taskCount > 0) {
    return {
      percent: Math.round((totals.doneCount / totals.taskCount) * 100),
      unit: "tasks",
      done: totals.doneCount,
      total: totals.taskCount,
    };
  }
  return { percent: 0, unit: "minutes", done: 0, total: totalMinutes };
}

// --- État lisible du portefeuille --------------------------------------------------------------

export type ProjectHealthKind =
  "late" | "blocked" | "waiting_content" | "in_validation" | "on_time" | "waiting" | "done";

export interface ProjectHealth {
  kind: ProjectHealthKind;
  label: string;
  tone: "success" | "warn" | "danger" | "neutral" | "accent";
  /** Jours de retard, pour `late`. */
  lateDays?: number;
}

/** Colonne STATUT de l'écran 08 : un seul état, le plus grave d'abord. */
export function projectHealth(
  project: { status: string; dueOn: string | null },
  context: { today: string; openBlockers: number; expectedRequirements: number },
): ProjectHealth {
  if (project.status === "delivered") {
    return { kind: "done", label: "Livré", tone: "success" };
  }
  if (project.status === "closed") {
    return { kind: "done", label: "Clôturé", tone: "neutral" };
  }
  if (project.status === "preparation") {
    return { kind: "waiting", label: "En attente", tone: "neutral" };
  }
  if (project.dueOn && project.dueOn < context.today) {
    const lateDays = daysBetween(project.dueOn, context.today);
    return { kind: "late", label: `En retard · ${lateDays} j`, tone: "danger", lateDays };
  }
  if (context.expectedRequirements > 0 && project.status === "blocked") {
    return { kind: "waiting_content", label: "Contenus attendus", tone: "warn" };
  }
  if (project.status === "blocked" || context.openBlockers > 0) {
    return { kind: "blocked", label: "Bloqué", tone: "warn" };
  }
  if (project.status === "in_validation") {
    return { kind: "in_validation", label: "En validation", tone: "warn" };
  }
  return { kind: "on_time", label: "Dans les temps", tone: "success" };
}

// --- Prévu et réalisé --------------------------------------------------------------------------

export interface BudgetConsumption {
  /** Coût du temps sur le budget vendu. `null` : pas de budget. */
  costPercent: number | null;
  /** Temps passé sur le temps vendu. `null` : pas d'estimation. */
  timePercent: number | null;
  /** Le plus élevé des deux : celui qui déclenche l'alerte. */
  percent: number | null;
  reached: boolean;
}

/** Le budget se consomme par le coût du temps comme par le temps vendu : le premier à 80 % alerte. */
export function budgetConsumption(input: {
  budgetCents: number | null;
  estimatedMinutes: number | null;
  consumedCents: number;
  spentMinutes: number;
}): BudgetConsumption {
  const costPercent =
    input.budgetCents && input.budgetCents > 0
      ? (input.consumedCents / input.budgetCents) * 100
      : null;
  const timePercent =
    input.estimatedMinutes && input.estimatedMinutes > 0
      ? (input.spentMinutes / input.estimatedMinutes) * 100
      : null;
  const known = [costPercent, timePercent].filter((value): value is number => value !== null);
  const percent = known.length > 0 ? Math.max(...known) : null;
  return {
    costPercent,
    timePercent,
    percent,
    reached: percent !== null && percent >= BUDGET_ALERT_PERCENT,
  };
}

/**
 * « Prévu à date » : part de l'enveloppe qui devrait être consommée aujourd'hui, à rythme constant
 * entre le début et l'échéance. `null` si l'une des bornes manque.
 */
export function plannedMinutesToDate(input: {
  startOn: string | null;
  dueOn: string | null;
  estimatedMinutes: number | null;
  today: string;
}): number | null {
  const { startOn, dueOn, estimatedMinutes, today } = input;
  if (!startOn || !dueOn || !estimatedMinutes) return null;
  const span = daysBetween(startOn, dueOn);
  if (span <= 0) return estimatedMinutes;
  const elapsed = Math.max(0, Math.min(span, daysBetween(startOn, today)));
  return Math.round((estimatedMinutes * elapsed) / span);
}

// --- Dépendances -------------------------------------------------------------------------------

export interface DependencyEdge {
  taskId: string;
  dependsOnTaskId: string;
}

/** Vrai si ajouter « `taskId` dépend de `dependsOnTaskId` » fermerait une boucle. */
export function wouldCreateCycle(
  edges: readonly DependencyEdge[],
  taskId: string,
  dependsOnTaskId: string,
): boolean {
  if (taskId === dependsOnTaskId) return true;
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = next.get(edge.taskId);
    if (targets) targets.push(edge.dependsOnTaskId);
    else next.set(edge.taskId, [edge.dependsOnTaskId]);
  }
  const seen = new Set<string>();
  const stack = [dependsOnTaskId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(next.get(current) ?? []));
  }
  return false;
}

// --- Modèles de plan ---------------------------------------------------------------------------

const planTaskSchema = z.union([
  z.string().trim().min(1),
  z.object({
    title: z.string().trim().min(1),
    estimatedMinutes: z.number().int().positive().optional(),
    description: z.string().optional(),
  }),
]);

const planItemSchema = z.union([
  z.string().trim().min(1),
  z.object({
    name: z.string().trim().min(1),
    clientVisible: z.boolean().optional(),
    /** Échéance du jalon, en jours après le début du projet. */
    dueOffsetDays: z.number().int().nonnegative().optional(),
    tasks: z.array(planTaskSchema).optional(),
  }),
]);

export interface PlanPhase {
  name: string;
  clientVisible: boolean;
  dueOffsetDays: number | null;
  tasks: { title: string; estimatedMinutes: number | null; description: string | null }[];
}

/**
 * Lit `templates.items` d'un `project_plan` : une liste de noms de jalons, ou d'objets avec leurs
 * tâches initiales. Un modèle illisible ou vide donne `null` : l'appelant prend le plan standard.
 */
export function parsePlanItems(items: unknown): PlanPhase[] | null {
  const parsed = z.array(planItemSchema).min(1).safeParse(items);
  if (!parsed.success) return null;
  return parsed.data.map((item) =>
    typeof item === "string"
      ? { name: item, clientVisible: true, dueOffsetDays: null, tasks: [] }
      : {
          name: item.name,
          clientVisible: item.clientVisible ?? true,
          dueOffsetDays: item.dueOffsetDays ?? null,
          tasks: (item.tasks ?? []).map((task) =>
            typeof task === "string"
              ? { title: task, estimatedMinutes: null, description: null }
              : {
                  title: task.title,
                  estimatedMinutes: task.estimatedMinutes ?? null,
                  description: task.description ?? null,
                },
          ),
        },
  );
}

export function standardPlan(): PlanPhase[] {
  return STANDARD_MILESTONES.map((name) => ({
    name,
    clientVisible: true,
    dueOffsetDays: null,
    tasks: [],
  }));
}

/**
 * Passation d'un projet sans modèle (domaine 05.05.03) : sans elle, rien ne retiendrait la clôture.
 */
export function standardHandover(): string[] {
  return [
    "Mise en ligne vérifiée",
    "Accès remis au client",
    "Documents transmis",
    "Contrat de maintenance proposé",
  ];
}

/** Lit `templates.items` d'une checklist : des libellés, ou des objets `{ label }`. */
export function parseChecklistItems(items: unknown): string[] {
  const parsed = z
    .array(z.union([z.string().trim().min(1), z.object({ label: z.string().trim().min(1) })]))
    .safeParse(items);
  if (!parsed.success) return [];
  return parsed.data.map((item) => (typeof item === "string" ? item : item.label));
}

// --- Présentation ------------------------------------------------------------------------------

/**
 * Le nom d'un projet porte souvent son client (`Atelier Lune · Site vitrine`). Écran 08 : le client
 * est en titre, seule l'offre reste dessous.
 */
export function offerLabel(projectName: string, companyName: string): string {
  const prefix = `${companyName} · `;
  return projectName.startsWith(prefix) ? projectName.slice(prefix.length) : projectName;
}

/** Titre de l'écran 17 : `Atelier Lune · Site vitrine`. */
export function projectTitle(projectName: string, companyName: string): string {
  return `${companyName} · ${offerLabel(projectName, companyName)}`;
}

export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

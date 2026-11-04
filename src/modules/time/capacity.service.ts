import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";
import { parseInput } from "@/server/validation";
import { parisToday, weekStart, type DayRange } from "./calendar";
import {
  computeOverview,
  computeWeekLoads,
  simulateProject,
  type CapacityOverview,
  type ProjectSimulation,
  type WeekLoad,
} from "./capacity";
import * as timeRepository from "./time.repository";
import { simulationSchema } from "./time.schema";

export type { CapacityOverview, MemberCapacity, ProjectSimulation, WeekLoad } from "./capacity";

function pastPart(range: DayRange, today: string): DayRange | null {
  const to = range.to < today ? range.to : today;
  return range.from > to ? null : { from: range.from, to };
}

/**
 * Capacité et charge par membre sur une période (bornes incluses). `plannedMinutes` additionne le
 * temps saisi jusqu'à aujourd'hui et le reste à faire réparti sur les jours à venir.
 * Sans contrôle d'accès ni coût : l'appelant est un service qui a vérifié ses droits (tableau de bord).
 */
export async function getCapacityOverview(
  db: Database,
  range: DayRange,
  options: { today?: string } = {},
): Promise<CapacityOverview> {
  const today = options.today ?? parisToday();
  const [data, actual] = await Promise.all([
    timeRepository.loadPlanningData(db, range.from < today ? range.from : today),
    (() => {
      const past = pastPart(range, today);
      return past
        ? timeRepository.sumMinutesByMember(db, past)
        : Promise.resolve(new Map<string, number>());
    })(),
  ]);
  return computeOverview(data, range, today, actual);
}

/** Six semaines de charge à partir de la semaine courante. Sans contrôle d'accès ni coût. */
export async function getSixWeekLoad(
  db: Database,
  options: { today?: string } = {},
): Promise<WeekLoad[]> {
  const today = options.today ?? parisToday();
  const monday = weekStart(today);
  const [data, actual] = await Promise.all([
    timeRepository.loadPlanningData(db, monday),
    timeRepository.sumMinutesByDay(db, { from: monday, to: today }),
  ]);
  return computeWeekLoads(data, today, actual);
}

/**
 * Début possible et mise en ligne réaliste d'un nouveau projet, d'après la charge réelle. Rien n'est
 * enregistré : aucun audit. Lecture de la capacité d'équipe : `time:read`.
 */
export async function simulateNewProject(
  ctx: ServiceContext,
  input: unknown,
): Promise<ProjectSimulation> {
  assertCan(ctx.actor, "time:read");
  const { estimatedMinutes } = parseInput(simulationSchema, input);
  const today = parisToday();
  const data = await timeRepository.loadPlanningData(ctx.db, today);
  return simulateProject(data, today, estimatedMinutes);
}

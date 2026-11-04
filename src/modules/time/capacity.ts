import { MINUTES_PER_DAY } from "@/lib/format";
import {
  addDays,
  eachDay,
  isWorkingDay,
  type DayRange,
  weekEnd,
  weekKey,
  weekLabel,
  weekStart,
} from "./calendar";

/**
 * Calcul de capacité et de charge (A6, A7), sans base : la capacité vient de chaque membre
 * (`weekly_capacity_minutes` moins ses absences), la charge du reste à faire des projets signés.
 *
 * Répartition du reste à faire :
 * - une tâche ouverte estimée va à son responsable, jusqu'à son échéance ;
 * - le reste du projet (estimé moins consommé moins tâches assignées) va aux membres du projet,
 *   sinon à son responsable, sinon à l'équipe sans personne désignée ;
 * - sans échéance tenable (absente ou dépassée), une personne y travaille à plein temps à partir
 *   du premier jour possible : un retard pèse sur les jours qui viennent, pas sur un seul jour.
 */
export interface PlanMember {
  id: string;
  fullName: string;
  kind: string;
  title: string | null;
  weeklyCapacityMinutes: number;
}

export interface PlanAbsence {
  memberId: string;
  startOn: string;
  endOn: string;
}

export interface PlanProject {
  id: string;
  startOn: string | null;
  dueOn: string | null;
  /** Estimé moins consommé, jamais négatif. */
  remainingMinutes: number;
  ownerMemberId: string | null;
  memberIds: readonly string[];
}

export interface PlanTask {
  projectId: string;
  assigneeMemberId: string | null;
  dueOn: string | null;
  /** Estimé moins consommé, jamais négatif. */
  remainingMinutes: number;
}

export interface PlanningData {
  members: readonly PlanMember[];
  absences: readonly PlanAbsence[];
  projects: readonly PlanProject[];
  tasks: readonly PlanTask[];
}

/** Charge à venir : jour → (membre ou `null`) → minutes. */
export type Forecast = Map<string, Map<string | null, number>>;

/** Rythme d'une personne à plein temps, repère des journées dans toute l'interface. */
const FULL_TIME_MINUTES_PER_DAY = MINUTES_PER_DAY;

function workingDaysBetween(from: string, to: string): string[] {
  return eachDay(from, to).filter(isWorkingDay);
}

function nextWorkingDay(day: string): string {
  let current = day;
  while (!isWorkingDay(current)) current = addDays(current, 1);
  return current;
}

function addLoad(forecast: Forecast, day: string, memberId: string | null, minutes: number): void {
  let byMember = forecast.get(day);
  if (!byMember) {
    byMember = new Map();
    forecast.set(day, byMember);
  }
  byMember.set(memberId, (byMember.get(memberId) ?? 0) + minutes);
}

/** Répartit `minutes` à parts égales sur les jours ouvrés ou, sans échéance tenable, à plein temps. */
function spread(
  forecast: Forecast,
  minutes: number,
  memberIds: readonly (string | null)[],
  from: string,
  dueOn: string | null,
): void {
  if (minutes <= 0 || memberIds.length === 0) return;
  const start = nextWorkingDay(from);
  const share = minutes / memberIds.length;

  for (const memberId of memberIds) {
    const days = dueOn && dueOn >= start ? workingDaysBetween(start, dueOn) : [];
    if (days.length > 0) {
      const perDay = share / days.length;
      for (const day of days) addLoad(forecast, day, memberId, perDay);
      continue;
    }
    let left = share;
    let day = start;
    while (left > 0) {
      const chunk = Math.min(left, FULL_TIME_MINUTES_PER_DAY);
      addLoad(forecast, day, memberId, chunk);
      left -= chunk;
      day = nextWorkingDay(addDays(day, 1));
    }
  }
}

export function buildForecast(data: PlanningData, today: string): Forecast {
  const forecast: Forecast = new Map();
  const assignedByProject = new Map<string, number>();
  const unassignedByProject = new Map<string, number>();
  const projects = new Map(data.projects.map((project) => [project.id, project]));

  for (const task of data.tasks) {
    const target = task.assigneeMemberId ? assignedByProject : unassignedByProject;
    target.set(task.projectId, (target.get(task.projectId) ?? 0) + task.remainingMinutes);

    if (!task.assigneeMemberId) continue;
    const project = projects.get(task.projectId);
    const from = project?.startOn && project.startOn > today ? project.startOn : today;
    spread(
      forecast,
      task.remainingMinutes,
      [task.assigneeMemberId],
      from,
      task.dueOn ?? project?.dueOn ?? null,
    );
  }

  for (const project of data.projects) {
    const assigned = assignedByProject.get(project.id) ?? 0;
    const unassigned = unassignedByProject.get(project.id) ?? 0;
    const pool = Math.max(project.remainingMinutes, assigned + unassigned) - assigned;
    const recipients: readonly (string | null)[] =
      project.memberIds.length > 0
        ? project.memberIds
        : project.ownerMemberId
          ? [project.ownerMemberId]
          : [null];
    const from = project.startOn && project.startOn > today ? project.startOn : today;
    spread(forecast, pool, recipients, from, project.dueOn);
  }

  return forecast;
}

/** Minutes disponibles par jour : semaine / 5, zéro le week-end et les jours d'absence. */
export class CapacityCalendar {
  private readonly absentDays = new Map<string, Set<string>>();

  constructor(
    private readonly members: readonly PlanMember[],
    absences: readonly PlanAbsence[],
  ) {
    for (const absence of absences) {
      let days = this.absentDays.get(absence.memberId);
      if (!days) {
        days = new Set();
        this.absentDays.set(absence.memberId, days);
      }
      for (const day of eachDay(absence.startOn, absence.endOn)) days.add(day);
    }
  }

  memberDay(member: PlanMember, day: string): number {
    if (!isWorkingDay(day) || this.absentDays.get(member.id)?.has(day)) return 0;
    return member.weeklyCapacityMinutes / 5;
  }

  teamDay(day: string): number {
    return this.members.reduce((sum, member) => sum + this.memberDay(member, day), 0);
  }

  /** Part de capacité perdue pour absence sur la période. */
  memberAbsence(member: PlanMember, range: DayRange): number {
    const days = this.absentDays.get(member.id);
    if (!days) return 0;
    return (
      workingDaysBetween(range.from, range.to).filter((day) => days.has(day)).length *
      (member.weeklyCapacityMinutes / 5)
    );
  }
}

/** Charge d'une période : `null` sans capacité, jamais un faux 0 %. */
export function loadPercentOf(plannedMinutes: number, capacityMinutes: number): number | null {
  if (capacityMinutes <= 0) return null;
  return Math.round((plannedMinutes / capacityMinutes) * 100);
}

function forecastBetween(forecast: Forecast, range: DayRange, memberId?: string | null): number {
  let total = 0;
  for (const day of eachDay(range.from, range.to)) {
    const byMember = forecast.get(day);
    if (!byMember) continue;
    if (memberId === undefined) {
      for (const minutes of byMember.values()) total += minutes;
    } else {
      total += byMember.get(memberId) ?? 0;
    }
  }
  return total;
}

export interface WeekLoad {
  /** Lundi de la semaine. */
  weekStart: string;
  weekEnd: string;
  /** `2026-W45`. */
  weekKey: string;
  /** `S45`. */
  label: string;
  capacityMinutes: number;
  plannedMinutes: number;
  /** Prévu / disponible ; `null` sans capacité. Seuils A7 : `loadTone` de `gauge.tsx`. */
  loadPercent: number | null;
}

export interface MemberCapacity {
  memberId: string;
  fullName: string;
  kind: string;
  title: string | null;
  weeklyCapacityMinutes: number;
  /** Capacité perdue pour absence sur la période. */
  absenceMinutes: number;
  /** Capacité nette, absences déduites. */
  capacityMinutes: number;
  /** Temps saisi jusqu'à aujourd'hui, plus charge à venir. */
  plannedMinutes: number;
  /** Temps saisi sur la période. */
  actualMinutes: number;
  loadPercent: number | null;
}

export interface CapacityOverview {
  range: DayRange;
  today: string;
  members: MemberCapacity[];
  capacityMinutes: number;
  plannedMinutes: number;
  actualMinutes: number;
  loadPercent: number | null;
  /** Charge sans personne désignée, comptée au total mais sur aucune ligne de membre. */
  unassignedMinutes: number;
}

/** Part à venir d'une période : à partir d'aujourd'hui, jamais avant. */
function futurePart(range: DayRange, today: string): DayRange | null {
  const from = range.from > today ? range.from : today;
  return from > range.to ? null : { from, to: range.to };
}

export function computeOverview(
  data: PlanningData,
  range: DayRange,
  today: string,
  actualByMember: ReadonlyMap<string, number>,
): CapacityOverview {
  const forecast = buildForecast(data, today);
  const calendar = new CapacityCalendar(data.members, data.absences);
  const future = futurePart(range, today);
  const days = eachDay(range.from, range.to);

  const members = data.members.map((member): MemberCapacity => {
    const actual = actualByMember.get(member.id) ?? 0;
    const capacity = days.reduce((sum, day) => sum + calendar.memberDay(member, day), 0);
    const planned = actual + (future ? forecastBetween(forecast, future, member.id) : 0);
    return {
      memberId: member.id,
      fullName: member.fullName,
      kind: member.kind,
      title: member.title,
      weeklyCapacityMinutes: member.weeklyCapacityMinutes,
      absenceMinutes: Math.round(calendar.memberAbsence(member, range)),
      capacityMinutes: Math.round(capacity),
      plannedMinutes: Math.round(planned),
      actualMinutes: actual,
      loadPercent: loadPercentOf(planned, capacity),
    };
  });

  let actualTotal = 0;
  for (const minutes of actualByMember.values()) actualTotal += minutes;
  const capacityTotal = days.reduce((sum, day) => sum + calendar.teamDay(day), 0);
  const plannedTotal = actualTotal + (future ? forecastBetween(forecast, future) : 0);

  return {
    range,
    today,
    members,
    capacityMinutes: Math.round(capacityTotal),
    plannedMinutes: Math.round(plannedTotal),
    actualMinutes: actualTotal,
    loadPercent: loadPercentOf(plannedTotal, capacityTotal),
    unassignedMinutes: Math.round(future ? forecastBetween(forecast, future, null) : 0),
  };
}

/** `weeks` semaines à partir de la semaine courante, charge passée de la semaine comprise. */
export function computeWeekLoads(
  data: PlanningData,
  today: string,
  actualByDay: ReadonlyMap<string, number>,
  weeks = 6,
): WeekLoad[] {
  const forecast = buildForecast(data, today);
  const calendar = new CapacityCalendar(data.members, data.absences);
  const firstMonday = weekStart(today);

  return Array.from({ length: weeks }, (_, index) => {
    const monday = addDays(firstMonday, index * 7);
    const sunday = weekEnd(monday);
    const days = eachDay(monday, sunday);
    const capacity = days.reduce((sum, day) => sum + calendar.teamDay(day), 0);
    const actual = days.reduce((sum, day) => sum + (actualByDay.get(day) ?? 0), 0);
    const future = futurePart({ from: monday, to: sunday }, today);
    const planned = actual + (future ? forecastBetween(forecast, future) : 0);
    return {
      weekStart: monday,
      weekEnd: sunday,
      weekKey: weekKey(monday),
      label: weekLabel(monday),
      capacityMinutes: Math.round(capacity),
      plannedMinutes: Math.round(planned),
      loadPercent: loadPercentOf(planned, capacity),
    };
  });
}

export interface ProjectSimulation {
  estimatedMinutes: number;
  /** `null` si le plan ne dégage pas assez de place dans l'horizon. */
  startOn: string | null;
  goLiveOn: string | null;
  /** Semaine la plus chargée une fois le projet ajouté. */
  peak: { label: string; loadPercent: number } | null;
  capacityMinutesPerWeek: number;
}

/** Seuil A7 : un nouveau projet ne prend que la place sous 90 % de charge. */
const SIMULATION_CEILING = 0.9;
/** Il faut au moins une part réelle de la journée de libre pour démarrer un projet. */
const MINIMUM_FREE_MINUTES = 60;
/** Au-delà de deux ans, une date annoncée n'a plus de sens. */
const SIMULATION_HORIZON_DAYS = 730;

/**
 * Date réaliste d'un nouveau projet : une personne à plein temps au plus, dans la place libre sous
 * 90 % de charge, jour par jour. Les jours fériés ne sont pas déduits : aucune donnée ne les porte.
 */
export function simulateProject(
  data: PlanningData,
  today: string,
  estimatedMinutes: number,
): ProjectSimulation {
  const forecast = buildForecast(data, today);
  const calendar = new CapacityCalendar(data.members, data.absences);
  const added = new Map<string, number>();
  let left = estimatedMinutes;
  let startOn: string | null = null;
  let goLiveOn: string | null = null;

  for (let offset = 1; offset <= SIMULATION_HORIZON_DAYS && left > 0; offset += 1) {
    const day = addDays(today, offset);
    if (!isWorkingDay(day)) continue;
    const load = forecastBetween(forecast, { from: day, to: day });
    const free = calendar.teamDay(day) * SIMULATION_CEILING - load;
    if (free < MINIMUM_FREE_MINUTES) continue;
    const taken = Math.min(free, FULL_TIME_MINUTES_PER_DAY, left);
    startOn ??= day;
    added.set(day, taken);
    left -= taken;
    if (left <= 0) goLiveOn = day;
  }

  let peak: ProjectSimulation["peak"] = null;
  if (goLiveOn && startOn) {
    for (
      let monday = weekStart(startOn);
      monday <= weekStart(goLiveOn);
      monday = addDays(monday, 7)
    ) {
      const days = eachDay(monday, weekEnd(monday));
      const capacity = days.reduce((sum, day) => sum + calendar.teamDay(day), 0);
      const load = forecastBetween(forecast, { from: monday, to: weekEnd(monday) });
      const extra = days.reduce((sum, day) => sum + (added.get(day) ?? 0), 0);
      const percent = loadPercentOf(load + extra, capacity);
      if (percent !== null && (!peak || percent > peak.loadPercent)) {
        peak = { label: weekLabel(monday), loadPercent: percent };
      }
    }
  }

  const thisMonday = weekStart(today);
  const capacityMinutesPerWeek = eachDay(thisMonday, weekEnd(thisMonday)).reduce(
    (sum, day) => sum + calendar.teamDay(day),
    0,
  );

  return {
    estimatedMinutes,
    startOn: goLiveOn ? startOn : null,
    goLiveOn,
    peak,
    capacityMinutesPerWeek: Math.round(capacityMinutesPerWeek),
  };
}

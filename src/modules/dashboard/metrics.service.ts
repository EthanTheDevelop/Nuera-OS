import type { OfferActivity } from "@/lib/domain-enums";
import { lastMonths, type DayRange } from "@/modules/finance/finance.dates";
import { getMargins } from "@/modules/finance/profitability.service";
import type { Database } from "@/server/db/types";
import * as repository from "./dashboard.repository";
import { REVENUE_ACTIVITY_LABELS, type RevenueActivity } from "./metrics.constants";
import { monthsIn, type Bucket } from "./reporting.periods";

/**
 * Calculs partagés du tableau de bord et du reporting (arbitrage A3) : les deux écrans lisent ces
 * fonctions, aucun chiffre n'a deux formules. Sans contrôle d'accès : les appelants ont vérifié.
 * Montants HT en centimes, durées en minutes. La marge vient de `getMargins`, et de lui seul.
 */

export { REVENUE_ACTIVITY_LABELS };
export type { RevenueActivity };

const CONTRACT_KIND_ACTIVITY: Record<string, RevenueActivity> = {
  hosting: "hebergement",
  maintenance: "maintenance",
  support: "support",
  accompaniment: "accompagnement",
};

const RECURRING_ACTIVITIES: ReadonlySet<RevenueActivity> = new Set([
  "hebergement",
  "maintenance",
  "support",
  "accompagnement",
]);

export function isRecurringActivity(activity: RevenueActivity): boolean {
  return RECURRING_ACTIVITIES.has(activity);
}

function activityOf(row: {
  activity: string | null;
  contractKind: string | null;
}): RevenueActivity {
  if (row.activity) return row.activity as OfferActivity;
  if (row.contractKind) return CONTRACT_KIND_ACTIVITY[row.contractKind] ?? "none";
  return "none";
}

export interface RevenuePoint {
  key: string;
  projectCents: number;
  recurringCents: number;
  totalCents: number;
}

/** Facturé HT par case de temps. `activity` restreint à une activité. */
export async function getRevenueByBucket(
  db: Database,
  buckets: readonly Pick<Bucket, "key" | "range">[],
  options: { activity?: RevenueActivity } = {},
): Promise<RevenuePoint[]> {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (!first || !last) return [];
  const rows = await repository.listRevenueRows(db, { from: first.range.from, to: last.range.to });
  const matching = options.activity
    ? rows.filter((row) => activityOf(row) === options.activity)
    : rows;
  return buckets.map((bucket) => {
    const months = new Set(monthsIn(bucket.range));
    const inBucket = matching.filter((row) => months.has(row.month));
    const sum = (stream: repository.RevenueRow["stream"]) =>
      inBucket.filter((row) => row.stream === stream).reduce((total, row) => total + row.cents, 0);
    const projectCents = sum("project");
    const recurringCents = sum("recurring");
    return {
      key: bucket.key,
      projectCents,
      recurringCents,
      totalCents: projectCents + recurringCents,
    };
  });
}

/** Six derniers mois, le mois de `today` compris : la tuile Chiffre d'affaires. */
export async function getRevenueSixMonths(db: Database, today: string) {
  const months = lastMonths(today, 6);
  const points = await getRevenueByBucket(
    db,
    months.map((month) => ({ key: month.key, range: month.range })),
  );
  return months.map((month, index) => ({
    month,
    point: points[index] ?? { key: month.key, projectCents: 0, recurringCents: 0, totalCents: 0 },
  }));
}

export interface ActivityMargin {
  activity: RevenueActivity;
  revenueCents: number;
  /** Coût réel des objets dont le revenu est connu : un objet sans revenu ne fait pas une marge. */
  costCents: number;
  /** Tout le temps saisi, revenu connu ou non. */
  minutes: number;
  /** NULL sans revenu : non calculable, jamais 0. */
  marginPercent: number | null;
}

export interface PeriodMargin {
  revenueCents: number;
  marginCents: number;
  /** NULL sans revenu : non calculable, jamais 0. */
  percent: number | null;
  /** Clients comptés. */
  clients: number;
  /** Clients avec du temps ou des coûts, mais aucune facture sur la période : hors du calcul. */
  withoutRevenue: number;
  byActivity: ActivityMargin[];
}

/**
 * Marge réelle d'une période. Le total se calcule par client : une facture rattachée à la fois à un
 * projet et à un contrat ne compte qu'une fois. La ventilation se lit par projet et par contrat.
 */
export async function getPeriodMargin(
  db: Database,
  range: DayRange,
  now: Date,
): Promise<PeriodMargin> {
  const subjects = await repository.listMarginSubjects(db, range);
  const [clients, projects, contracts] = await Promise.all([
    getMargins(db, { scope: "client", ids: subjects.companyIds, period: range }, now),
    getMargins(
      db,
      { scope: "project", ids: subjects.projects.map((row) => row.id), period: range },
      now,
    ),
    getMargins(
      db,
      { scope: "contract", ids: subjects.contracts.map((row) => row.id), period: range },
      now,
    ),
  ]);

  let revenueCents = 0;
  let marginCents = 0;
  let counted = 0;
  let withoutRevenue = 0;
  for (const margin of clients.values()) {
    const { revenueCents: revenue, marginCents: value } = margin.actual;
    if (revenue === null || value === null) {
      withoutRevenue += 1;
      continue;
    }
    revenueCents += revenue;
    marginCents += value;
    counted += 1;
  }

  const groups = new Map<RevenueActivity, { revenue: number; cost: number; minutes: number }>();
  const add = (
    activity: RevenueActivity,
    figures: { revenueCents: number | null; totalCostCents: number; minutes: number },
  ) => {
    const group = groups.get(activity) ?? { revenue: 0, cost: 0, minutes: 0 };
    group.minutes += figures.minutes;
    if (figures.revenueCents !== null) {
      group.revenue += figures.revenueCents;
      group.cost += figures.totalCostCents;
    }
    groups.set(activity, group);
  };
  for (const { id, activity } of subjects.projects) {
    const margin = projects.get(id);
    if (margin) add(activityOf({ activity, contractKind: null }), margin.actual);
  }
  for (const { id, kind } of subjects.contracts) {
    const margin = contracts.get(id);
    if (margin) add(activityOf({ activity: null, contractKind: kind }), margin.actual);
  }

  return {
    revenueCents,
    marginCents,
    percent: revenueCents > 0 ? (marginCents / revenueCents) * 100 : null,
    clients: counted,
    withoutRevenue,
    byActivity: [...groups.entries()].map(([activity, group]) => ({
      activity,
      revenueCents: group.revenue,
      costCents: group.cost,
      minutes: group.minutes,
      marginPercent:
        group.revenue > 0 ? ((group.revenue - group.cost) / group.revenue) * 100 : null,
    })),
  };
}

export interface SalesPerformance {
  won: number;
  lost: number;
  /** Gagnées sur closes. NULL sans affaire close. */
  conversionPercent: number | null;
  averageSignatureDays: number | null;
  lostReasons: { reason: string; total: number }[];
}

const LOST_REASONS_SHOWN = 5;

export async function getSalesPerformance(
  db: Database,
  range: DayRange,
): Promise<SalesPerformance> {
  const [rows, averageDays, lostReasons] = await Promise.all([
    repository.listWonLostByMonth(db, range),
    repository.averageSignatureDays(db, range),
    repository.listLostReasons(db, range, LOST_REASONS_SHOWN),
  ]);
  const won = rows.reduce((total, row) => total + row.won, 0);
  const lost = rows.reduce((total, row) => total + row.lost, 0);
  return {
    won,
    lost,
    conversionPercent: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
    averageSignatureDays: averageDays,
    lostReasons,
  };
}

export interface WonLostPoint {
  key: string;
  won: number;
  lost: number;
}

export async function getWonLostByBucket(
  db: Database,
  buckets: readonly Pick<Bucket, "key" | "range">[],
): Promise<WonLostPoint[]> {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (!first || !last) return [];
  const rows = await repository.listWonLostByMonth(db, {
    from: first.range.from,
    to: last.range.to,
  });
  return buckets.map((bucket) => {
    const months = new Set(monthsIn(bucket.range));
    const inBucket = rows.filter((row) => months.has(row.month));
    return {
      key: bucket.key,
      won: inBucket.reduce((total, row) => total + row.won, 0),
      lost: inBucket.reduce((total, row) => total + row.lost, 0),
    };
  });
}

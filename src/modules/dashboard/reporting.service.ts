import { formatDays, formatNumber, MINUTES_PER_DAY } from "@/lib/format";
import { centsToEuros, formatCents, formatCentsSigned } from "@/lib/money";
import { z } from "@/lib/zod";
import { recordAudit } from "@/modules/audit/audit.service";
import { getRecurringRevenue } from "@/modules/contracts/contract.service";
import { centsToCsvEuros, toCsv } from "@/modules/finance/finance.csv";
import { parisDay, type DayRange } from "@/modules/finance/finance.dates";
import { getFinanceSummary } from "@/modules/finance/finance.service";
import { assertCan, can } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { logger } from "@/server/logger";
import { parseInput } from "@/server/validation";
import * as repository from "./dashboard.repository";
import {
  getPeriodMargin,
  getRevenueByBucket,
  getSalesPerformance,
  getWonLostByBucket,
  isRecurringActivity,
  REVENUE_ACTIVITY_LABELS,
  type PeriodMargin,
  type RevenueActivity,
  type SalesPerformance,
} from "./metrics.service";
import {
  buildBuckets,
  deltaPercent,
  endOfParisDay,
  GRANULARITIES,
  PERIOD_KEYS,
  resolvePeriod,
  sameBucketLastYear,
  type Bucket,
  type Granularity,
  type PeriodKey,
} from "./reporting.periods";

/** Vient de l'URL : une valeur inconnue retombe sur le défaut, elle ne casse pas la page. */
const reportingQuerySchema = z.object({
  periode: z.enum(PERIOD_KEYS).catch("mois"),
  granularite: z.enum(GRANULARITIES).catch("mois"),
  activite: z
    .enum(Object.keys(REVENUE_ACTIVITY_LABELS) as [RevenueActivity, ...RevenueActivity[]])
    .optional()
    .catch(undefined),
});
export type ReportingQuery = z.input<typeof reportingQuerySchema>;

/** Une section isolée : son échec reste le sien. */
export type Section<T> = { status: "ready"; data: T } | { status: "error" };

async function section<T>(name: string, load: () => Promise<T>): Promise<Section<T>> {
  try {
    return { status: "ready", data: await load() };
  } catch (error) {
    logger.error("reporting.section_failed", { section: name, error });
    return { status: "error" };
  }
}

export interface ChartPointView {
  label: string;
  tooltipLabel: string;
  note?: string;
  noteTone?: "muted" | "success" | "warn" | "danger";
}

export interface RevenueSection {
  totalCents: number;
  previousCents: number;
  /** NULL sans base de comparaison. */
  deltaPercent: number | null;
  points: ChartPointView[];
  currentLabel: string;
  previousLabel: string;
  current: number[];
  previous: number[];
}

export interface RecurringSection {
  mrrCents: number;
  activeCount: number;
  points: ChartPointView[];
  values: number[];
}

export interface MarginSection {
  /** NULL sans revenu : non calculable, jamais 0. */
  percent: number | null;
  /** Pourquoi le chiffre manque ou reste partiel. */
  withoutRevenue: number;
  points: ChartPointView[];
  /** Pourcentages réels, négatifs compris. */
  values: (number | null)[];
  /** Ce que dessine la courbe, dont l'échelle part de 0 : le réel reste dans l'info-bulle. */
  chartValues: (number | null)[];
}

export interface ConversionSection {
  percent: number | null;
  won: number;
  lost: number;
  points: ChartPointView[];
  wonSeries: number[];
  lostSeries: number[];
}

export interface ActivityRow {
  activity: RevenueActivity;
  label: string;
  revenue: string;
  days: string;
  margin: string;
  /** Part du chiffre d'affaires, de 0 à 100. */
  share: number;
  revenueCents: number;
  minutes: number;
  marginPercent: number | null;
}

export interface ForecastSection {
  /** Échéances de contrats signés, pas encore facturées. */
  certainCents: number;
  certainCount: number;
  probableCents: number;
  probableCount: number;
  withoutProbability: number;
  hypotheticalCents: number;
  hypotheticalCount: number;
}

export interface ReportingData {
  periodKey: PeriodKey;
  granularity: Granularity;
  activity: RevenueActivity | null;
  label: string;
  previousLabel: string;
  canExport: boolean;
  canSeeFinance: boolean;
  revenue?: Section<RevenueSection>;
  recurring?: Section<RecurringSection>;
  margin?: Section<MarginSection>;
  conversion?: Section<ConversionSection>;
  activities?: Section<ActivityRow[]>;
  sales?: Section<SalesPerformance>;
  forecast?: Section<ForecastSection>;
}

const toPoint = (bucket: Bucket): ChartPointView => ({
  label: bucket.label,
  tooltipLabel: bucket.tooltipLabel.toLocaleUpperCase("fr-FR"),
});

function buildActivityRows(
  margin: PeriodMargin,
  totalRevenueCents: number,
  monthly: boolean,
  only: RevenueActivity | null,
): ActivityRow[] {
  const attributed = margin.byActivity.reduce((total, row) => total + row.revenueCents, 0);
  const rest = totalRevenueCents - attributed;
  const rows = [
    ...margin.byActivity,
    ...(rest > 0
      ? [
          {
            activity: "none" as const,
            revenueCents: rest,
            costCents: 0,
            minutes: 0,
            marginPercent: null,
          },
        ]
      : []),
  ];
  const base = Math.max(totalRevenueCents, attributed);
  return rows
    .filter((row) => !only || row.activity === only)
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .map((row) => {
      const perMonth = monthly && isRecurringActivity(row.activity) ? "/mois" : "";
      return {
        activity: row.activity,
        label: REVENUE_ACTIVITY_LABELS[row.activity],
        revenue: `${formatCents(row.revenueCents)}${perMonth}`,
        days: row.minutes > 0 ? `${formatDays(row.minutes)}${perMonth}` : "—",
        margin: row.marginPercent === null ? "—" : `${formatNumber(row.marginPercent)} %`,
        share: base > 0 ? Math.round((row.revenueCents / base) * 100) : 0,
        revenueCents: row.revenueCents,
        minutes: row.minutes,
        marginPercent: row.marginPercent,
      };
    });
}

/**
 * Le reporting (écran 16), calculé par les mêmes fonctions que le tableau de bord (A3). Chaque
 * section vérifie son droit et échoue seule. Sans `finance:read`, rien de financier n'est lu.
 */
export async function getReporting(
  ctx: ServiceContext,
  rawQuery: unknown = {},
  now: Date = new Date(),
): Promise<ReportingData> {
  assertCan(ctx.actor, "dashboard:read");
  const query = parseInput(reportingQuerySchema, rawQuery ?? {});
  const canSeeFinance = can(ctx.actor, "finance:read");
  const canSeeSales = can(ctx.actor, "sales:read");
  const activity = canSeeFinance ? (query.activite ?? null) : null;
  const { db } = ctx;

  const today = parisDay(now);
  const period = resolvePeriod(query.periode, today);
  const end = period.range.to < today ? period.range.to : today;
  const buckets = buildBuckets(query.granularite, end);
  const monthly = query.periode === "mois" || query.periode === "mois-dernier";

  // Une même période n'est calculée qu'une fois, quelle que soit la section qui la lit.
  const marginCache = new Map<string, Promise<PeriodMargin>>();
  const marginOf = (range: DayRange) => {
    const key = `${range.from}:${range.to}`;
    let value = marginCache.get(key);
    if (!value) {
      value = getPeriodMargin(db, range, now);
      marginCache.set(key, value);
    }
    return value;
  };
  const percentOf = (margin: PeriodMargin): number | null =>
    activity
      ? (margin.byActivity.find((row) => row.activity === activity)?.marginPercent ?? null)
      : margin.percent;

  const revenueOptions = activity ? { activity } : {};
  const [revenue, recurring, margin, conversion, activities, sales, forecast] = await Promise.all([
    canSeeFinance
      ? section("revenue", async () => {
          const [[current, previous], series, lastYear] = await Promise.all([
            getRevenueByBucket(
              db,
              [
                { key: "previous", range: period.previous },
                { key: "current", range: period.range },
              ],
              revenueOptions,
            ).then(([before, selected]) => [selected, before]),
            getRevenueByBucket(db, buckets, revenueOptions),
            getRevenueByBucket(
              db,
              buckets.map((bucket) => ({ key: bucket.key, range: sameBucketLastYear(bucket) })),
              revenueOptions,
            ),
          ]);
          const totalCents = current?.totalCents ?? 0;
          const previousCents = previous?.totalCents ?? 0;
          const year = end.slice(0, 4);
          return {
            totalCents,
            previousCents,
            deltaPercent: deltaPercent(totalCents, previousCents),
            points: buckets.map((bucket, index) => {
              const value = series[index]?.totalCents ?? 0;
              const before = lastYear[index]?.totalCents ?? 0;
              return {
                ...toPoint(bucket),
                note: `${formatCentsSigned(value - before)} sur un an`,
                noteTone: value >= before ? ("success" as const) : ("danger" as const),
              };
            }),
            currentLabel: query.granularite === "annee" ? "Année" : year,
            previousLabel:
              query.granularite === "annee"
                ? "Année précédente"
                : `${Number(year) - 1} · même période`,
            current: series.map((point) => centsToEuros(point.totalCents)),
            previous: lastYear.map((point) => centsToEuros(point.totalCents)),
          } satisfies RevenueSection;
        })
      : undefined,
    canSeeFinance
      ? section("recurring", async () => {
          const readings = await Promise.all(
            buckets.map((bucket) =>
              getRecurringRevenue(db, { at: endOfParisDay(bucket.range.to, now) }),
            ),
          );
          const selected = await getRecurringRevenue(db, { at: endOfParisDay(end, now) });
          return {
            mrrCents: selected.mrrCents,
            activeCount: selected.activeCount,
            points: buckets.map((bucket, index) => {
              const value = readings[index]?.mrrCents ?? 0;
              const before = readings[index - 1]?.mrrCents;
              const change = before === undefined ? null : value - before;
              const previousName = buckets[index - 1]?.label.toLocaleLowerCase("fr-FR");
              return {
                ...toPoint(bucket),
                note:
                  change === null ? undefined : `${formatCentsSigned(change)} vs ${previousName}`,
                noteTone:
                  change === null || change === 0
                    ? ("muted" as const)
                    : change > 0
                      ? ("success" as const)
                      : ("danger" as const),
              };
            }),
            values: readings.map((reading) => centsToEuros(reading.mrrCents)),
          } satisfies RecurringSection;
        })
      : undefined,
    canSeeFinance
      ? section("margin", async () => {
          const [selected, series] = await Promise.all([
            marginOf(period.range),
            Promise.all(buckets.map((bucket) => marginOf(bucket.range))),
          ]);
          const values = series.map((row) => {
            const percent = percentOf(row);
            return percent === null ? null : Math.round(percent);
          });
          return {
            percent: percentOf(selected),
            withoutRevenue: selected.withoutRevenue,
            points: buckets.map((bucket, index) => {
              const value = values[index] ?? null;
              return value !== null && value < 0
                ? {
                    ...toPoint(bucket),
                    note: `Marge réelle : ${formatNumber(value)} %`,
                    noteTone: "danger" as const,
                  }
                : toPoint(bucket);
            }),
            values,
            chartValues: values.map((value) =>
              value === null ? null : Math.min(100, Math.max(0, value)),
            ),
          } satisfies MarginSection;
        })
      : undefined,
    canSeeSales
      ? section("conversion", async () => {
          const [performance, series] = await Promise.all([
            getSalesPerformance(db, period.range),
            getWonLostByBucket(db, buckets),
          ]);
          return {
            percent: performance.conversionPercent,
            won: performance.won,
            lost: performance.lost,
            points: buckets.map(toPoint),
            wonSeries: series.map((point) => point.won),
            lostSeries: series.map((point) => point.lost),
          } satisfies ConversionSection;
        })
      : undefined,
    canSeeFinance
      ? section("activities", async () => {
          const [selected, totals] = await Promise.all([
            marginOf(period.range),
            getRevenueByBucket(db, [{ key: "period", range: period.range }]),
          ]);
          return buildActivityRows(selected, totals[0]?.totalCents ?? 0, monthly, activity);
        })
      : undefined,
    canSeeSales ? section("sales", () => getSalesPerformance(db, period.range)) : undefined,
    canSeeFinance
      ? section("forecast", async () => {
          const [summary, probable, hypothetical] = await Promise.all([
            getFinanceSummary(db, period.range, now),
            repository.sumProbableQuotes(db),
            repository.sumHypotheticalPipeline(db),
          ]);
          return {
            certainCents: summary.plannedScheduleCents,
            certainCount: summary.plannedScheduleCount,
            probableCents: probable.cents,
            probableCount: probable.withProbability,
            withoutProbability: probable.withoutProbability,
            hypotheticalCents: hypothetical.cents,
            hypotheticalCount: hypothetical.total,
          } satisfies ForecastSection;
        })
      : undefined,
  ]);

  return {
    periodKey: query.periode,
    granularity: query.granularite,
    activity,
    label: period.label,
    previousLabel: period.previousLabel,
    canExport: can(ctx.actor, "export:run") && canSeeFinance,
    canSeeFinance,
    revenue,
    recurring,
    margin,
    conversion,
    activities,
    sales,
    forecast,
  };
}

// --- Export ------------------------------------------------------------------------------------

const CSV_HEADERS = ["Section", "Indicateur", "Valeur", "Unité", "Comparaison", "Période"];
const SECTION_FAILED = "Section indisponible au moment de l'export";

type CsvRow = (string | number | null)[];

/**
 * Le reporting en CSV, généré côté serveur et tracé dans le journal. Mêmes chiffres que l'écran : les
 * lignes sortent de `getReporting`. Un montant absent reste une cellule vide, jamais 0.
 */
export async function exportReportingCsv(
  ctx: ServiceContext,
  rawQuery: unknown = {},
  now: Date = new Date(),
): Promise<{ filename: string; csv: string; rows: number }> {
  assertCan(ctx.actor, "finance:read");
  assertCan(ctx.actor, "export:run");
  const data = await getReporting(ctx, rawQuery, now);
  const period = data.activity
    ? `${data.label} · ${REVENUE_ACTIVITY_LABELS[data.activity]}`
    : data.label;
  const rows: CsvRow[] = [];
  const line = (
    name: string,
    indicator: string,
    value: string | number | null,
    unit: string,
    compare: string | number | null = null,
  ) => rows.push([name, indicator, value, unit, compare, period]);
  const failed = (name: string) => line(name, SECTION_FAILED, null, "");
  const percent = (value: number | null) =>
    value === null ? null : formatNumber(value, 1).replace(/\s/g, "");

  if (data.revenue?.status === "ready") {
    const { totalCents, previousCents, points, current, previous } = data.revenue.data;
    line(
      "Chiffre d'affaires",
      "Facturé HT",
      centsToCsvEuros(totalCents),
      "€",
      centsToCsvEuros(previousCents),
    );
    points.forEach((point, index) => {
      line(
        "Chiffre d'affaires par période",
        point.tooltipLabel,
        current[index] ?? null,
        "€",
        previous[index] ?? null,
      );
    });
  } else if (data.revenue) failed("Chiffre d'affaires");

  if (data.recurring?.status === "ready") {
    const { mrrCents, activeCount, points, values } = data.recurring.data;
    line("Revenus récurrents", "MRR", centsToCsvEuros(mrrCents), "€/mois");
    line("Revenus récurrents", "Contrats en vigueur", activeCount, "contrats");
    points.forEach((point, index) => {
      line("Revenus récurrents par période", point.tooltipLabel, values[index] ?? null, "€/mois");
    });
  } else if (data.recurring) failed("Revenus récurrents");

  if (data.margin?.status === "ready") {
    const { percent: value, points, values } = data.margin.data;
    line("Marge", "Marge réelle", percent(value), "%");
    points.forEach((point, index) => {
      line("Marge par période", point.tooltipLabel, values[index] ?? null, "%");
    });
  } else if (data.margin) failed("Marge");

  if (data.activities?.status === "ready") {
    for (const row of data.activities.data) {
      line("Activité", `${row.label} · CA`, centsToCsvEuros(row.revenueCents), "€");
      line(
        "Activité",
        `${row.label} · journées`,
        formatNumber(row.minutes / MINUTES_PER_DAY, 1).replace(/\s/g, ""),
        "j",
      );
      line("Activité", `${row.label} · marge`, percent(row.marginPercent), "%");
      line("Activité", `${row.label} · part`, row.share, "%");
    }
  } else if (data.activities) failed("Activité");

  if (data.sales?.status === "ready") {
    const { won, lost, conversionPercent, averageSignatureDays, lostReasons } = data.sales.data;
    line("Ventes", "Opportunités gagnées", won, "affaires");
    line("Ventes", "Opportunités perdues", lost, "affaires");
    line("Ventes", "Conversion", conversionPercent, "%");
    line("Ventes", "Délai moyen de signature", percent(averageSignatureDays), "jours");
    for (const { reason, total } of lostReasons) line("Raison de perte", reason, total, "affaires");
  } else if (data.sales) failed("Ventes");

  if (data.forecast?.status === "ready") {
    const { certainCents, probableCents, hypotheticalCents } = data.forecast.data;
    line("Prévision", "Certain · contrats signés", centsToCsvEuros(certainCents), "€");
    line(
      "Prévision",
      "Probable · devis envoyés × probabilité",
      centsToCsvEuros(probableCents),
      "€",
    );
    line("Prévision", "Hypothétique · pipeline", centsToCsvEuros(hypotheticalCents), "€");
  } else if (data.forecast) failed("Prévision");

  await recordAudit(ctx.db, {
    actorId: ctx.actor.userId,
    action: "export.run",
    entityType: "export",
    metadata: {
      module: "reporting",
      rows: rows.length,
      period: data.periodKey,
      activity: data.activity,
    },
  });

  return {
    filename: `nuera-reporting-${data.periodKey}-${parisDay(now)}.csv`,
    csv: toCsv(CSV_HEADERS, rows),
    rows: rows.length,
  };
}

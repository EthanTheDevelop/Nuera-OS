"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { ComparedBars } from "@/components/charts/compared-bars";
import { AreaLine, StepLine } from "@/components/charts/line-charts";
import { WonLostBars } from "@/components/charts/won-lost-bars";
import { RollingNumber } from "@/components/motion/rolling-number";
import { EmptyState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Gauge } from "@/components/ui/gauge";
import { Icon } from "@/components/ui/icon";
import { Menu } from "@/components/ui/popover";
import { KpiTabs, type KpiTabItem } from "@/components/ui/tabs";
import { TileHeader } from "@/components/ui/tile";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { centsToEuros } from "@/lib/money";
import { hrefWith } from "@/lib/url-state";
import { REVENUE_ACTIVITY_LABELS, type RevenueActivity } from "../metrics.constants";
import {
  GRANULARITIES,
  GRANULARITY_LABELS,
  PERIOD_KEYS,
  PERIOD_LABELS,
} from "../reporting.periods";
import type { ActivityRow, ReportingData } from "../reporting.service";
import { plural, ready, SectionError } from "./reporting-cards";

const PATH = "/reporting";
const EXPORT_PATH = "/api/reporting/export";
const EURO_FORMAT = {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
} as const;
const GRANULARITY_PER = { mois: "par mois", trimestre: "par trimestre", annee: "par année" };
const MEASURES = ["ca", "recurrents", "marge", "conversion"] as const;

const SECTION_ERROR = <SectionError />;

/** Le « Mois · Trimestre · Année » de l'en-tête du graphique : de vrais liens, partageables. */
function GranularitySwitch({
  current,
  params,
}: {
  current: ReportingData["granularity"];
  params: URLSearchParams;
}) {
  return (
    <nav aria-label="Découpage du graphique" className="flex items-center gap-1 text-xs text-muted">
      {GRANULARITIES.map((granularity, index) => (
        <span key={granularity} className="flex items-center gap-1">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <Link
            href={hrefWith(PATH, params, {
              granularite: granularity === "mois" ? null : granularity,
            })}
            aria-current={granularity === current ? "true" : undefined}
            scroll={false}
            className={cn(
              "hit-44 rounded-sm hover:text-text",
              granularity === current && "font-semibold text-text",
            )}
          >
            {GRANULARITY_LABELS[granularity]}
          </Link>
        </span>
      ))}
    </nav>
  );
}

function ChartCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-xl bg-surface p-6 shadow-soft">
      <TileHeader icon="chart" title={title} aside={aside} />
      {children}
    </div>
  );
}

const ACTIVITY_COLUMNS: readonly DataTableColumn<ActivityRow>[] = [
  {
    key: "activity",
    header: "ACTIVITÉ",
    primary: true,
    cell: (row) => <span className="font-medium text-ink">{row.label}</span>,
  },
  { key: "revenue", header: "CA", width: 110, cell: (row) => row.revenue },
  { key: "days", header: "JOURNÉES", width: 100, cell: (row) => row.days },
  { key: "margin", header: "MARGE", width: 90, cell: (row) => row.margin },
  {
    key: "share",
    header: "PART",
    width: 140,
    cell: (row) => (
      <span className="flex items-center gap-2">
        <Gauge
          value={row.share}
          label={`Part de ${row.label}`}
          valueText={`${row.share} %`}
          className="flex-1"
        />
        <span className="tabular w-9 shrink-0 text-right">{row.share} %</span>
      </span>
    ),
  },
];

/** Écran 16 et M2 : les 4 cartes du haut pilotent le graphique ; le cadre, lui, ne bouge pas. */
export function ReportingView({ data, aside }: { data: ReportingData; aside?: ReactNode }) {
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  const requested = params.get("mesure");
  const [measure, setMeasure] = useState(
    MEASURES.includes(requested as (typeof MEASURES)[number]) ? (requested as string) : "",
  );

  const per = GRANULARITY_PER[data.granularity];
  const switcher = <GranularitySwitch current={data.granularity} params={params} />;
  const revenue = ready(data.revenue);
  const recurring = ready(data.recurring);
  const margin = ready(data.margin);
  const conversion = ready(data.conversion);
  const tabs: KpiTabItem[] = [];

  if (data.revenue) {
    const delta = revenue?.deltaPercent ?? null;
    tabs.push({
      id: "ca",
      label: "Chiffre d’affaires",
      value: revenue ? (
        <RollingNumber value={centsToEuros(revenue.totalCents)} format={EURO_FORMAT} />
      ) : (
        "—"
      ),
      note: !revenue
        ? undefined
        : delta === null
          ? `Rien à comparer en ${data.previousLabel}`
          : `${delta >= 0 ? "+" : "−"}${Math.abs(delta)} % vs ${data.previousLabel}`,
      noteTone: delta === null ? "muted" : delta >= 0 ? "success" : "danger",
      content: (
        <ChartCard title="Comparaison des périodes" aside={switcher}>
          {revenue ? (
            <ComparedBars
              title="Chiffre d’affaires comparé à l’année précédente"
              points={revenue.points}
              current={{ label: revenue.currentLabel, values: revenue.current }}
              previous={{ label: revenue.previousLabel, values: revenue.previous }}
              valueFormat={{ format: EURO_FORMAT }}
            />
          ) : (
            SECTION_ERROR
          )}
        </ChartCard>
      ),
    });
  }
  if (data.recurring) {
    tabs.push({
      id: "recurrents",
      label: "Revenus récurrents",
      value: recurring ? (
        <RollingNumber
          value={centsToEuros(recurring.mrrCents)}
          format={EURO_FORMAT}
          suffix="/mois"
        />
      ) : (
        "—"
      ),
      note: recurring
        ? `${recurring.activeCount} ${plural(recurring.activeCount, "contrat actif", "contrats actifs")}`
        : undefined,
      content: (
        <ChartCard title={`Revenus récurrents · ${per}`} aside={switcher}>
          {recurring ? (
            <AreaLine
              title={`Revenus récurrents ${per}`}
              points={recurring.points}
              values={recurring.values}
              seriesLabel="Revenus récurrents"
              valueFormat={{ format: EURO_FORMAT, suffix: "/mois" }}
              height={152}
            />
          ) : (
            SECTION_ERROR
          )}
        </ChartCard>
      ),
    });
  }
  if (data.margin) {
    tabs.push({
      id: "marge",
      label: "Marge estimée",
      value:
        margin && margin.percent !== null ? (
          <RollingNumber value={Math.round(margin.percent)} suffix=" %" />
        ) : (
          "—"
        ),
      note: margin
        ? margin.percent === null
          ? "Non calculable : aucune facture sur la période"
          : margin.withoutRevenue > 0
            ? `après temps et coûts · ${margin.withoutRevenue} ${plural(margin.withoutRevenue, "client")} hors calcul`
            : "après temps passé et coûts"
        : undefined,
      content: (
        <ChartCard title={`Marge estimée · ${per}`} aside={switcher}>
          {margin ? (
            <StepLine
              title={`Marge estimée ${per}`}
              points={margin.points}
              values={margin.chartValues}
              seriesLabel="Marge"
              valueFormat={{ suffix: " %" }}
              max={100}
            />
          ) : (
            SECTION_ERROR
          )}
        </ChartCard>
      ),
    });
  }
  if (data.conversion) {
    tabs.push({
      id: "conversion",
      label: "Conversion",
      value:
        conversion && conversion.percent !== null ? (
          <RollingNumber value={conversion.percent} suffix=" %" />
        ) : (
          "—"
        ),
      note: conversion
        ? `${conversion.won} ${plural(conversion.won, "gagnée")} · ${conversion.lost} ${plural(conversion.lost, "perdue")}`
        : undefined,
      content: (
        <ChartCard title="Affaires gagnées et perdues" aside={switcher}>
          {conversion ? (
            <WonLostBars
              title="Affaires gagnées et perdues"
              points={conversion.points}
              won={conversion.wonSeries}
              lost={conversion.lostSeries}
              height={200}
            />
          ) : (
            SECTION_ERROR
          )}
        </ChartCard>
      ),
    });
  }

  const activities = ready(data.activities);

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-x-5 gap-y-6",
        aside && "lg:grid-cols-[minmax(0,1fr)_360px]",
      )}
    >
      {tabs.length > 0 ? (
        <KpiTabs
          items={tabs}
          label="Mesures du reporting"
          className="contents [&>*:first-child]:lg:col-span-full"
          panelClassName="min-w-0"
          // `?mesure=` d'un lien partagé peut viser une mesure que ce rôle n'a pas.
          defaultValue={tabs.some((tab) => tab.id === measure) ? measure : tabs[0]?.id}
          onValueChange={(id) => {
            setMeasure(id);
            const next = hrefWith(PATH, params, { mesure: id === tabs[0]?.id ? null : id });
            window.history.replaceState(null, "", next);
          }}
        />
      ) : (
        <EmptyState
          icon="chart"
          title="Aucun indicateur accessible"
          description="Votre rôle ne donne accès à aucune mesure du reporting."
        />
      )}

      {aside ? <aside className="flex min-w-0 flex-col gap-6 lg:row-span-2">{aside}</aside> : null}

      {data.activities ? (
        <div className="min-w-0">
          {data.activities.status === "error" ? (
            SECTION_ERROR
          ) : (
            <DataTable
              caption="Chiffre d’affaires, temps et marge par activité"
              columns={ACTIVITY_COLUMNS}
              rows={activities ?? []}
              rowKey={(row) => row.activity}
              empty={
                <EmptyState
                  compact
                  icon="chart"
                  title="Aucune activité sur cette période"
                  description="Le chiffre d’affaires et le temps saisis s’afficheront par activité."
                />
              }
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

const SELECTED = (
  <span className="flex text-accent">
    <Icon name="check" size={16} />
    <span className="sr-only">sélectionné</span>
  </span>
);

/** « Ce mois ▾ » : la période et, avec les finances, l'activité. */
export function ReportingFilters({ data }: { data: ReportingData }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  const label = data.activity
    ? `${PERIOD_LABELS[data.periodKey]} · ${REVENUE_ACTIVITY_LABELS[data.activity]}`
    : PERIOD_LABELS[data.periodKey];
  const activities = Object.keys(REVENUE_ACTIVITY_LABELS) as RevenueActivity[];
  const toast = useToast();
  const [exporting, startExport] = useTransition();

  function exportCsv() {
    startExport(async () => {
      const failed = (message = "L’export n’a pas pu être généré. Réessayez dans un instant.") =>
        toast({ tone: "danger", message });
      try {
        const response = await fetch(hrefWith(EXPORT_PATH, params, { mesure: null }));
        // Un compte à enrôler est redirigé : suivre, ne pas enregistrer sa page comme un CSV.
        if (response.redirected) {
          window.location.assign(response.url);
          return;
        }
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          failed(body?.error);
          return;
        }
        const disposition = response.headers.get("Content-Disposition") ?? "";
        const href = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = href;
        link.download = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "nuera-reporting.csv";
        link.click();
        URL.revokeObjectURL(href);
      } catch {
        failed();
      }
    });
  }

  return (
    <>
      <Menu
        label="Période"
        placement="bottom-end"
        width={260}
        trigger={(props) => (
          <Button {...props}>
            {label}
            <span aria-hidden="true" className="text-[10px]">
              ▾
            </span>
          </Button>
        )}
        items={[
          ...PERIOD_KEYS.map((key) => ({
            key,
            label: PERIOD_LABELS[key],
            aside: key === data.periodKey ? SELECTED : undefined,
            onSelect: () =>
              router.push(hrefWith(PATH, params, { periode: key === "mois" ? null : key })),
          })),
          ...(data.canSeeFinance
            ? [
                {
                  key: "all",
                  label: "Toutes les activités",
                  separatorBefore: true,
                  aside: data.activity === null ? SELECTED : undefined,
                  onSelect: () => router.push(hrefWith(PATH, params, { activite: null })),
                },
                ...activities.map((activity) => ({
                  key: activity,
                  label: REVENUE_ACTIVITY_LABELS[activity],
                  aside: activity === data.activity ? SELECTED : undefined,
                  onSelect: () => router.push(hrefWith(PATH, params, { activite: activity })),
                })),
              ]
            : []),
        ]}
      />
      {data.canExport ? (
        <Button icon="download" loading={exporting} onClick={exportCsv}>
          Exporter
        </Button>
      ) : null}
    </>
  );
}

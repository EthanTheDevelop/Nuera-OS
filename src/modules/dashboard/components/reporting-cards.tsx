import { ErrorState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { Gauge } from "@/components/ui/gauge";
import { InfoCard, InfoRow } from "@/components/ui/info-card";
import { formatNumber } from "@/lib/format";
import { formatCents } from "@/lib/money";
import type { ReportingData, Section } from "../reporting.service";

export const plural = (count: number, one: string, many = `${one}s`) => (count > 1 ? many : one);

export function ready<T>(section: Section<T> | undefined): T | null {
  return section?.status === "ready" ? section.data : null;
}

/** Une section qui n'a pas pu être lue : le reste de la page reste en place. */
export function SectionError() {
  return (
    <ErrorState
      compact
      title="Donnée indisponible"
      description="Cette section n’a pas pu être lue."
    />
  );
}

export function SalesCard({ section }: { section: ReportingData["sales"] }) {
  const sales = ready(section);
  return (
    <InfoCard icon="pipeline" title="Performance des ventes">
      {section?.status === "error" ? <SectionError /> : null}
      {sales ? (
        <>
          <dl className="flex flex-col gap-2">
            <InfoRow
              label="Opportunités gagnées"
              value={<Badge tone="success">{sales.won}</Badge>}
            />
            <InfoRow label="Perdues" value={<Badge tone="danger">{sales.lost}</Badge>} />
            <InfoRow
              label="Délai moyen de signature"
              value={
                sales.averageSignatureDays === null
                  ? "—"
                  : `${formatNumber(sales.averageSignatureDays)} ${plural(Math.round(sales.averageSignatureDays), "jour")}`
              }
            />
          </dl>
          {sales.lostReasons.length > 0 ? (
            <>
              <h3 className="text-sm font-semibold text-ink">Raisons de perte</h3>
              <ul className="flex flex-col gap-2">
                {sales.lostReasons.map(({ reason, total }, index) => (
                  <li key={reason} className="flex flex-col gap-1">
                    <span className="text-xs text-text">{reason}</span>
                    <Gauge
                      value={total}
                      max={Math.max(...sales.lostReasons.map((row) => row.total))}
                      tone="danger"
                      label={reason}
                      valueText={`${total} ${plural(total, "affaire")}`}
                      index={index}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </InfoCard>
  );
}

export function ForecastCard({ section }: { section: NonNullable<ReportingData["forecast"]> }) {
  const forecast = ready(section);
  return (
    <InfoCard icon="euro" title="Prévision du chiffre d’affaires">
      {section.status === "error" ? <SectionError /> : null}
      {forecast ? (
        <>
          <dl className="flex flex-col gap-2">
            <InfoRow label="Certain · contrats signés" value={formatCents(forecast.certainCents)} />
            <InfoRow
              label="Probable · devis envoyés × probabilité"
              value={formatCents(forecast.probableCents)}
            />
            <InfoRow
              label="Hypothétique · pipeline"
              value={formatCents(forecast.hypotheticalCents)}
            />
          </dl>
          <p className="text-xs text-muted">
            Le certain et l’hypothétique ne sont jamais additionnés.
            {forecast.withoutProbability > 0
              ? ` ${forecast.withoutProbability} devis sans probabilité, hors du calcul.`
              : ""}
          </p>
        </>
      ) : null}
    </InfoCard>
  );
}

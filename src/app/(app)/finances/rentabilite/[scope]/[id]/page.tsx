import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Gauge } from "@/components/ui/gauge";
import { InfoCard } from "@/components/ui/info-card";
import { formatMinutes, formatPercent } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { FinanceForbidden } from "@/modules/finance/components/finance-forbidden";
import { marginTone } from "@/modules/finance/components/finance-format";
import { isMarginScope } from "@/modules/finance/finance.constants";
import {
  getMarginForActor,
  type MarginFigures,
  type MarginLine,
} from "@/modules/finance/profitability.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

export const metadata: Metadata = { title: "Détail de la marge" };

function lineRow(line: MarginLine) {
  return {
    key: line.key,
    label: (
      <span className="flex flex-col">
        {line.label}
        {line.detail ? <span className="text-xs text-muted">{line.detail}</span> : null}
      </span>
    ),
    value: `${line.side === "cost" ? "− " : ""}${formatCents(line.amountCents)}`,
  };
}

/** Une colonne du calcul : ce qui entre, ce qui sort, ce qui manque. */
function MarginColumn({ title, figures }: { title: string; figures: MarginFigures }) {
  const percent = figures.marginPercent;
  return (
    <InfoCard
      icon="chart"
      title={title}
      aside={
        figures.revenueCents === null ? <Badge tone="warn">Revenu indisponible</Badge> : undefined
      }
      rows={[
        ...figures.lines.map(lineRow),
        {
          key: "cost",
          label: <strong className="font-semibold">Coût total</strong>,
          value: <strong className="font-semibold">{formatCents(figures.totalCostCents)}</strong>,
        },
        {
          key: "margin",
          label: <strong className="font-semibold">Marge HT</strong>,
          value: (
            <strong className="font-semibold">
              {figures.marginCents === null ? "Indisponible" : formatCents(figures.marginCents)}
              {percent !== null ? ` · ${formatPercent(percent)}` : ""}
            </strong>
          ),
        },
      ]}
    >
      {percent !== null ? (
        <Gauge
          value={Math.max(0, percent)}
          tone={marginTone(percent)}
          height={8}
          label={`Taux de marge, ${title.toLocaleLowerCase("fr-FR")}`}
          valueText={formatPercent(percent)}
        />
      ) : null}
      {figures.minutes > 0 ? (
        <p className="text-xs text-muted">Temps compté : {formatMinutes(figures.minutes)}.</p>
      ) : null}
      {figures.unavailable.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-warn">
          {figures.unavailable.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </InfoCard>
  );
}

export default async function MarginDetailPage({
  params,
}: {
  params: Promise<{ scope: string; id: string }>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "finance:read")) return <FinanceForbidden />;

  const { scope, id } = await params;
  if (!isMarginScope(scope)) notFound();
  const margin = await getMarginForActor(ctx, { scope, id }).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="mb-0! lg:mb-0!"
        breadcrumbs={[
          { label: "Finances", href: "/finances" },
          { label: "Rentabilité", href: `/finances/rentabilite?vue=${scope}` },
          { label: margin.label },
        ]}
        title={margin.label}
        subtitle="Marge HT = revenus HT attribués − coûts directs attribués, coût du temps compris. Le prévisionnel et le réalisé ne s'additionnent jamais."
      />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <MarginColumn title="Prévisionnel" figures={margin.forecast} />
        <MarginColumn title="Réalisé" figures={margin.actual} />
      </div>
    </div>
  );
}

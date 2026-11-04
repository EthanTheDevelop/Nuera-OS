import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/states/states";
import { StatusBadge } from "@/components/ui/badge";
import { Gauge } from "@/components/ui/gauge";
import { InfoCard } from "@/components/ui/info-card";
import { formatDate } from "@/lib/format";
import { formatCents, formatCentsHT, ratioPercent } from "@/lib/money";
import { ScheduleActions } from "@/modules/finance/components/finance-actions";
import { FinanceForbidden } from "@/modules/finance/components/finance-forbidden";
import { InvoiceTable } from "@/modules/finance/components/invoice-table";
import { getFinanceFormOptions, getScheduleDetail } from "@/modules/finance/finance.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

export const metadata: Metadata = { title: "Échéance" };

export default async function ScheduleItemPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "finance:read")) return <FinanceForbidden />;

  const { id } = await params;
  const { item, invoices } = await getScheduleDetail(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const options = await getFinanceFormOptions(ctx);
  const percent = ratioPercent(item.invoicedCents, item.amountCents) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="mb-0! lg:mb-0!"
        breadcrumbs={[
          { label: "Finances", href: "/finances" },
          { label: "Échéancier", href: "/finances/echeancier" },
          { label: item.label },
        ]}
        title={item.label}
        subtitle={`${item.companyName} · ${formatCentsHT(item.amountCents)} · prévue le ${formatDate(item.dueOn)}`}
        badges={<StatusBadge kind="schedule" status={item.status} />}
        actions={
          can(ctx.actor, "finance:manage") ? (
            <ScheduleActions item={item} options={options} canDelete={invoices.length === 0} />
          ) : null
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,728fr)_minmax(0,380fr)]">
        <InvoiceTable
          rows={invoices}
          empty={
            <EmptyState
              compact
              icon="euro"
              title="Aucune facture sur cette échéance"
              description="En co-traitance, ajoutez une référence par associé émetteur."
            />
          }
        />
        <InfoCard
          icon="clock"
          title="Couverture"
          rows={[
            { label: "Montant de l'échéance", value: formatCents(item.amountCents) },
            { label: "Facturé", value: formatCents(item.invoicedCents) },
            {
              label: "Reste à facturer",
              value: formatCents(Math.max(0, item.amountCents - item.invoicedCents)),
            },
            { label: "Projet", value: item.projectName ?? "—" },
            { label: "Contrat", value: item.contractName ?? "—" },
          ]}
        >
          <Gauge
            value={Math.min(percent, 100)}
            tone={percent >= 100 ? "success" : "accent"}
            height={8}
            label="Part de l'échéance facturée"
            valueText={`${Math.round(percent)} %`}
          />
        </InfoCard>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/feedback";
import { InfoCard } from "@/components/ui/info-card";
import {
  FINANCIAL_DOCUMENT_KIND_LABELS,
  FINANCIAL_DOCUMENT_SOURCE_LABELS,
} from "@/lib/domain-enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatCents, formatCentsHT } from "@/lib/money";
import { InvoiceActions } from "@/modules/finance/components/finance-actions";
import { FinanceForbidden } from "@/modules/finance/components/finance-forbidden";
import { daysBetween, parisDay } from "@/modules/finance/finance.dates";
import { NO_LEGAL_VALUE_NOTICE } from "@/modules/finance/finance.constants";
import { getFinanceFormOptions, getInvoice } from "@/modules/finance/finance.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

export const metadata: Metadata = { title: "Facture" };

const LINK = "text-accent underline-offset-4 hover:underline";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "finance:read")) return <FinanceForbidden />;

  const { id } = await params;
  const invoice = await getInvoice(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const options = await getFinanceFormOptions(ctx);
  const canManage = can(ctx.actor, "finance:manage");
  const today = parisDay(new Date());
  const daysLate =
    invoice.status === "overdue" && invoice.dueOn ? daysBetween(invoice.dueOn, today) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="mb-0! lg:mb-0!"
        breadcrumbs={[
          { label: "Finances", href: "/finances" },
          { label: invoice.externalRef ?? "Facture" },
        ]}
        title={invoice.externalRef ?? "Facture sans référence"}
        subtitle={`${FINANCIAL_DOCUMENT_KIND_LABELS[invoice.kind]} · ${invoice.companyName} · ${formatCentsHT(invoice.amountCents)}`}
        badges={
          <>
            <StatusBadge kind="invoice" status={invoice.status} />
            <Badge>{FINANCIAL_DOCUMENT_SOURCE_LABELS[invoice.source]}</Badge>
            <Badge tone={invoice.clientVisible ? "accent" : "neutral"}>
              {invoice.clientVisible ? "Partagé client" : "Interne"}
            </Badge>
          </>
        }
        actions={
          canManage ? <InvoiceActions invoice={invoice} options={options} today={today} /> : null
        }
      />

      {daysLate > 0 ? (
        <Alert tone="danger">
          En retard de {daysLate} jour{daysLate > 1 ? "s" : ""} : à relancer depuis Indy.
        </Alert>
      ) : null}

      <Alert tone="info">{NO_LEGAL_VALUE_NOTICE}</Alert>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <InfoCard
          icon="euro"
          title="Montants et dates"
          rows={[
            { label: "Montant HT", value: formatCents(invoice.amountCents) },
            { label: "TVA", value: formatCents(invoice.taxCents) },
            { label: "Émise le", value: formatDate(invoice.issuedOn) },
            { label: "Échéance", value: formatDate(invoice.dueOn) },
            { label: "Payée le", value: formatDate(invoice.paidOn) },
          ]}
        />
        <InfoCard
          icon="link"
          title="Rattachements"
          rows={[
            {
              label: "Client",
              value: (
                <Link href={`/clients/${invoice.companyId}`} className={LINK}>
                  {invoice.companyName}
                </Link>
              ),
            },
            {
              label: "Émise par",
              value: invoice.issuerName ?? <Badge tone="warn">À renseigner</Badge>,
            },
            {
              label: "Échéance liée",
              value: invoice.scheduleItemId ? (
                <Link href={`/finances/echeancier/${invoice.scheduleItemId}`} className={LINK}>
                  {invoice.scheduleLabel}
                </Link>
              ) : (
                "—"
              ),
            },
            {
              label: "Projet",
              value: invoice.projectId ? (
                <Link href={`/finances/rentabilite/project/${invoice.projectId}`} className={LINK}>
                  {invoice.projectName}
                </Link>
              ) : (
                "—"
              ),
            },
            {
              label: "Contrat",
              value: invoice.contractId ? (
                <Link
                  href={`/finances/rentabilite/contract/${invoice.contractId}`}
                  className={LINK}
                >
                  {invoice.contractName}
                </Link>
              ) : (
                "—"
              ),
            },
            {
              label: "Devis",
              value: invoice.quoteId ? (
                <Link href={`/devis/${invoice.quoteId}`} className={LINK}>
                  {invoice.quoteNumber}
                </Link>
              ) : (
                "—"
              ),
            },
            {
              label: "Justificatif",
              value: invoice.documentId ? (
                <Link href={`/documents/${invoice.documentId}`} className={LINK}>
                  {invoice.documentTitle}
                </Link>
              ) : (
                "—"
              ),
            },
            {
              label: "Importée",
              value: invoice.importedAt ? formatDateTime(invoice.importedAt) : "Non",
            },
          ]}
        />
      </div>
    </div>
  );
}

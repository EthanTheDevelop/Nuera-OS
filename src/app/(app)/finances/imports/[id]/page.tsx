import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/states/states";
import { ButtonExternalLink } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { formatDateTime } from "@/lib/format";
import { FinanceForbidden } from "@/modules/finance/components/finance-forbidden";
import { exportHref } from "@/modules/finance/finance.constants";
import { getImportReport } from "@/modules/finance/import.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

export const metadata: Metadata = { title: "Rapport d'import" };

export default async function ImportReportPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "finance:read")) return <FinanceForbidden />;

  const { id } = await params;
  const report = await getImportReport(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const unchanged =
    report.rowsTotal - report.rowsCreated - report.rowsUpdated - report.rowsRejected;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="mb-0! lg:mb-0!"
        breadcrumbs={[
          { label: "Finances", href: "/finances" },
          { label: "Imports", href: "/finances/imports" },
          { label: report.filename ?? "Rapport" },
        ]}
        title={report.filename ?? "Rapport d'import"}
        subtitle={`Importé le ${formatDateTime(report.at)} · ${report.rowsTotal} lignes lues`}
        actions={
          report.rowsRejected > 0 && can(ctx.actor, "export:run") ? (
            <ButtonExternalLink
              icon="download"
              target="_self"
              href={exportHref("rapport-import", report.id)}
            >
              Télécharger le rapport
            </ButtonExternalLink>
          ) : null
        }
      />
      <KpiGrid>
        <KpiCard label="Créées" value={report.rowsCreated} />
        <KpiCard label="Mises à jour" value={report.rowsUpdated} />
        <KpiCard label="Inchangées" value={Math.max(0, unchanged)} />
        <KpiCard
          label="Refusées"
          value={report.rowsRejected}
          noteTone={report.rowsRejected > 0 ? "danger" : "muted"}
          note={report.rowsRejected > 0 ? "à corriger dans le fichier" : "aucun refus"}
        />
      </KpiGrid>
      <DataTable
        caption="Lignes refusées"
        rows={report.rejections}
        rowKey={(row) => `${row.line}-${row.message}`}
        empty={<EmptyState compact icon="check" title="Aucune ligne refusée" />}
        columns={[
          {
            key: "line",
            header: "Ligne",
            width: 80,
            cell: (row) => <span className="font-mono text-amount-compact">{row.line}</span>,
          },
          {
            key: "ref",
            header: "Référence",
            width: 180,
            cell: (row) => (
              <span className="block truncate text-row-primary text-ink">
                {row.externalRef ?? "—"}
              </span>
            ),
          },
          { key: "message", header: "Motif", primary: true, cell: (row) => row.message },
        ]}
      />
    </div>
  );
}

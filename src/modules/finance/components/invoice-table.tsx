import type { ReactNode } from "react";
import { Build } from "@/components/motion/stagger";
import { StatusBadge } from "@/components/ui/badge";
import { DataTable, type DataTablePage, type DataTableQuery } from "@/components/ui/data-table";
import { formatCents } from "@/lib/money";
import type { InvoiceRow } from "../finance.service";
import { firstName } from "./finance-format";

/**
 * Rang dans la cascade (note 21) : 60 ms par ligne, et les factures d'une même échéance, une par
 * associé, arrivent ensemble.
 */
export function invoiceCascade(rows: readonly InvoiceRow[]): Map<string, number> {
  const ranks = new Map<string, number>();
  const groups = new Map<string, number>();
  let next = 0;
  for (const row of rows) {
    const group = row.scheduleItemId;
    let rank = group ? groups.get(group) : undefined;
    if (rank === undefined) {
      rank = next;
      next += 1;
      if (group) groups.set(group, rank);
    }
    ranks.set(row.id, rank);
  }
  return ranks;
}

function clientAndSubject(row: InvoiceRow): string {
  const subject = row.scheduleLabel ?? row.projectName ?? row.contractName;
  return subject ? `${row.companyName} · ${subject}` : row.companyName;
}

/** Factures (écran 21, 101:5478) : FACTURE INDY, CLIENT · PROJET, ÉMISE PAR, MONTANT, ÉTAT. */
export function InvoiceTable({
  rows,
  query,
  pagination,
  empty,
  className,
}: {
  rows: readonly InvoiceRow[];
  query?: DataTableQuery;
  pagination?: DataTablePage;
  empty?: ReactNode;
  className?: string;
}) {
  const ranks = invoiceCascade(rows);
  const cascade = (row: InvoiceRow, children: ReactNode) => (
    <Build index={ranks.get(row.id) ?? 0} className="min-w-0">
      {children}
    </Build>
  );
  return (
    <DataTable
      className={className}
      caption="Factures référencées"
      rows={rows}
      rowKey={(row) => row.id}
      rowHref={(row) => `/finances/factures/${row.id}`}
      query={query}
      pagination={pagination}
      empty={empty}
      columns={[
        {
          key: "ref",
          header: "Facture Indy",
          width: 164,
          primary: true,
          cell: (row) =>
            cascade(
              row,
              <span
                className="block truncate text-row-primary text-ink"
                title={row.externalRef ?? undefined}
              >
                {row.externalRef ?? "Sans référence"}
              </span>,
            ),
        },
        {
          key: "client",
          header: "Client · projet",
          cell: (row) =>
            cascade(row, <span className="block truncate">{clientAndSubject(row)}</span>),
        },
        {
          key: "issuer",
          header: "Émise par",
          width: 100,
          cell: (row) =>
            cascade(row, <span className="block truncate">{firstName(row.issuerName)}</span>),
        },
        {
          key: "amount",
          header: "Montant",
          width: 100,
          cell: (row) =>
            cascade(row, <span className="tabular">{formatCents(row.amountCents)}</span>),
        },
        {
          key: "status",
          header: "État",
          width: 110,
          cell: (row) =>
            cascade(
              row,
              <StatusBadge
                kind="invoice"
                status={row.status}
                className="transition-colors duration-(--dur-fast)"
              />,
            ),
        },
      ]}
    />
  );
}

import { EmptyState } from "@/components/states/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import {
  CellIdentity,
  DataTable,
  type DataTableColumn,
  type DataTablePage,
  type DataTableQuery,
} from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import type { QuoteStatus } from "@/lib/domain-enums";
import { formatDateShort } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { followUpDays, quoteRowHref } from "../quote.rules";

export interface QuoteRow {
  id: string;
  number: string;
  title: string;
  status: QuoteStatus;
  sentAt: Date | null;
  companyName: string;
  totalCents: number;
}

function QuoteStatusCell({ row, now }: { row: QuoteRow; now: Date }) {
  const days = followUpDays(row.status, row.sentAt, now);
  if (days !== null) return <Badge tone="warn">Relance J+{days}</Badge>;
  return <StatusBadge kind="quote" status={row.status} />;
}

/** Colonnes de l'écran 09 (Figma 87:2595) : largeurs de la maquette, marges de cellule comprises. */
function columns(now: Date): DataTableColumn<QuoteRow>[] {
  return [
    {
      key: "devis",
      header: "Devis",
      primary: true,
      cell: (row) => (
        <CellIdentity
          name={row.companyName}
          title={row.number}
          subtitle={`${row.companyName} · ${row.title}`}
        />
      ),
    },
    {
      key: "montant",
      header: "Montant",
      width: 106,
      cell: (row) => <span className="tabular">{formatCents(row.totalCents)}</span>,
    },
    {
      key: "statut",
      header: "Statut",
      width: 146,
      cell: (row) => <QuoteStatusCell row={row} now={now} />,
    },
    {
      key: "envoye",
      header: "Envoyé",
      width: 108,
      hideWhenCollapsed: true,
      cell: (row) => <span className="tabular">{formatDateShort(row.sentAt)}</span>,
    },
  ];
}

export function QuoteFilters() {
  return (
    <FilterBar searchParam="q" label="Filtrer les devis">
      <FilterChip param="statut">Tous</FilterChip>
      <FilterChip param="statut" value="brouillons">
        Brouillons
      </FilterChip>
      <FilterChip param="statut" value="envoyes">
        Envoyés
      </FilterChip>
      <FilterChip param="statut" value="signes">
        Signés
      </FilterChip>
      <FilterChip param="statut" value="refuses">
        Refusés
      </FilterChip>
    </FilterBar>
  );
}

export function QuoteList({
  rows,
  pagination,
  query,
  now,
  filtered,
  emptyAction,
}: {
  rows: readonly QuoteRow[];
  pagination: DataTablePage;
  query: DataTableQuery;
  now: Date;
  /** Une recherche ou un filtre est actif : le message de liste vide n'est pas le même. */
  filtered: boolean;
  emptyAction?: React.ReactNode;
}) {
  return (
    <DataTable
      caption="Devis"
      columns={columns(now)}
      rows={rows}
      rowKey={(row) => row.id}
      // Le filtre et la page suivent le devis ouvert : revenir à la liste ne les perd pas.
      rowHref={(row) => quoteRowHref(row.id, query.searchParams)}
      rowHeight="lg"
      query={query}
      pagination={pagination.total > pagination.pageSize ? pagination : undefined}
      empty={
        filtered ? (
          <EmptyState
            compact
            icon="search"
            title="Aucun devis ne correspond"
            description="Changez de filtre ou de recherche."
          />
        ) : (
          <EmptyState
            icon="devis"
            title="Aucun devis pour le moment"
            description="Créez le premier depuis le catalogue de prestations."
            action={emptyAction}
          />
        )
      }
    />
  );
}

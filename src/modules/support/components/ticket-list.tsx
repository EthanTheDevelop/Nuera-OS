import { EmptyState } from "@/components/states/states";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import {
  CellIdentity,
  CellMono,
  DataTable,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { formatDateShort } from "@/lib/format";
import type { SearchParamsLike } from "@/lib/url-state";
import { isTicketOverdue } from "../ticket.sla";
import type { TicketRow } from "../ticket.service";
import { overdueLabel } from "./ticket-view";

/** Vue liste, paginée côté serveur : tient quand le tableau ne suffit plus (plusieurs centaines). */
export function TicketList({
  result,
  params,
  path,
  now,
  hrefForTicket,
  filtered,
}: {
  result: { items: TicketRow[]; total: number; page: number; pageSize: number };
  params: SearchParamsLike;
  path: string;
  now: Date;
  hrefForTicket: (id: string) => string;
  filtered: boolean;
}) {
  const columns: DataTableColumn<TicketRow>[] = [
    {
      key: "demande",
      header: "DEMANDE",
      primary: true,
      cell: (row) => (
        <CellIdentity title={row.subject} subtitle={`${row.number} · ${row.companyName}`} />
      ),
    },
    {
      key: "statut",
      header: "STATUT",
      width: 120,
      cell: (row) => <StatusBadge kind="ticket" status={row.status} />,
    },
    {
      key: "gravite",
      header: "GRAVITÉ",
      width: 150,
      sortable: true,
      hideWhenCollapsed: true,
      cell: (row) => <StatusBadge kind="severity" status={row.severity} />,
    },
    {
      key: "couverture",
      header: "COUVERTURE",
      width: 130,
      cell: (row) => <StatusBadge kind="coverage" status={row.coverage} />,
    },
    {
      key: "responsable",
      header: "RESPONSABLE",
      width: 150,
      hideWhenCollapsed: true,
      cell: (row) =>
        row.assigneeName ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={row.assigneeName} size={22} />
            <span className="truncate">{row.assigneeName}</span>
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "echeance",
      header: "ÉCHÉANCE",
      width: 140,
      sortable: true,
      cell: (row) =>
        isTicketOverdue(row, now) && row.dueAt ? (
          <Badge tone="danger">{overdueLabel(row.dueAt, now)}</Badge>
        ) : (
          <CellMono>{row.dueAt ? formatDateShort(row.dueAt) : "—"}</CellMono>
        ),
    },
    {
      key: "creation",
      header: "REÇUE",
      width: 90,
      sortable: true,
      hideWhenCollapsed: true,
      cell: (row) => <CellMono>{formatDateShort(row.createdAt)}</CellMono>,
    },
  ];

  return (
    <DataTable
      caption="Liste des demandes"
      columns={columns}
      rows={result.items}
      rowKey={(row) => row.id}
      rowHref={(row) => hrefForTicket(row.id)}
      query={{ pathname: path, searchParams: params }}
      pagination={{ page: result.page, pageSize: result.pageSize, total: result.total }}
      empty={
        <EmptyState
          compact
          icon="support"
          title={filtered ? "Aucune demande pour ce filtre" : "Aucune demande pour le moment"}
          description={
            filtered
              ? "Modifiez les filtres ou la recherche."
              : "Les demandes attribuées ou reçues apparaîtront ici."
          }
        />
      }
    />
  );
}

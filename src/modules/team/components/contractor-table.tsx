import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  CellIdentity,
  DataTable,
  type DataTableColumn,
  type DataTablePage,
  type DataTableQuery,
} from "@/components/ui/data-table";
import { formatDateShort } from "@/lib/format";
import { formatCents } from "@/lib/money";
import type { ContractorSummary } from "../team.service";

/** Annuaire des prestataires : spécialité, historique, tarifs si l'acteur peut les voir. */
export function ContractorTable({
  contractors,
  showCosts,
  query,
  pagination,
  empty,
  className,
}: {
  contractors: readonly ContractorSummary[];
  showCosts: boolean;
  query?: DataTableQuery;
  pagination?: DataTablePage;
  empty?: ReactNode;
  className?: string;
}) {
  const columns: DataTableColumn<ContractorSummary>[] = [
    {
      key: "name",
      header: "PRESTATAIRE",
      primary: true,
      cell: ({ member }) => (
        <CellIdentity
          name={member.fullName}
          title={member.fullName}
          subtitle={member.specialty ?? member.title ?? undefined}
          avatarSize={28}
        />
      ),
    },
    {
      key: "missions",
      header: "MISSIONS",
      width: 170,
      cell: (item) => (
        <span className="tabular">
          {item.missionsOpen} en cours · {item.missionsDelivered} livrée
          {item.missionsDelivered > 1 ? "s" : ""}
        </span>
      ),
    },
    {
      key: "last",
      header: "DERNIÈRE ÉCHÉANCE",
      width: 150,
      cell: (item) => (item.lastDueOn ? formatDateShort(item.lastDueOn) : "—"),
    },
    ...(showCosts
      ? [
          {
            key: "rate",
            header: "TARIF JOUR",
            width: 110,
            cell: ({ member }: ContractorSummary) => (
              <span className="tabular">{formatCents(member.dayRateCents)}</span>
            ),
          },
          {
            key: "costs",
            header: "PRÉVU / ENGAGÉ",
            width: 160,
            cell: (item: ContractorSummary) => (
              <span className="tabular">
                {formatCents(item.plannedCostCents)} / {formatCents(item.committedCostCents)}
              </span>
            ),
          },
        ]
      : []),
    {
      key: "status",
      header: "STATUT",
      width: 100,
      cell: ({ member }) =>
        member.archivedAt ? (
          <Badge tone="neutral">Archivé</Badge>
        ) : member.status === "active" ? (
          <Badge tone="success">Actif</Badge>
        ) : (
          <Badge tone="neutral">Inactif</Badge>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={contractors}
      rowKey={(item) => item.member.id}
      rowHref={(item) => `/equipe/${item.member.id}`}
      caption="Prestataires"
      query={query}
      pagination={pagination}
      empty={empty}
      className={className}
    />
  );
}

import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  type DataTableColumn,
  type DataTablePage,
  type DataTableQuery,
} from "@/components/ui/data-table";
import { formatDateShort } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { parisToday } from "@/modules/time/calendar";
import { firstName } from "@/modules/time/time-format";
import { MISSION_STATUS_BADGES } from "../mission.status";
import type { MissionView } from "../team.service";

function missionWork(mission: MissionView): string {
  return (
    mission.projectName ??
    (mission.ticketNumber ? `${mission.ticketNumber} · ${mission.ticketSubject}` : "—")
  );
}

/** Échéance dépassée alors que la mission n'est ni livrée ni annulée. */
export function isMissionLate(mission: MissionView, today: string): boolean {
  return (
    mission.dueOn !== null &&
    mission.dueOn < today &&
    (mission.status === "planned" || mission.status === "in_progress")
  );
}

/** Livrable attendu et, s'il est là, sa réception : c'est la colonne LIVRABLE de l'écran 22. */
export function DeliverableState({ mission }: { mission: MissionView }) {
  if (mission.deliverableReceivedOn) {
    return <Badge tone="success">Reçu {formatDateShort(mission.deliverableReceivedOn)}</Badge>;
  }
  const { label, tone } = MISSION_STATUS_BADGES[mission.status];
  if (isMissionLate(mission, parisToday())) {
    return <Badge tone="danger">{label} · en retard</Badge>;
  }
  return <Badge tone={tone}>{label}</Badge>;
}

/** Missions (Figma 101:5873) : la ligne mène à la mission. Coûts uniquement si `showCosts`. */
export function MissionTable({
  missions,
  showCosts = false,
  showMember = true,
  caption = "Missions",
  query,
  pagination,
  empty,
}: {
  missions: readonly MissionView[];
  showCosts?: boolean;
  showMember?: boolean;
  caption?: string;
  query?: DataTableQuery;
  pagination?: DataTablePage;
  empty?: ReactNode;
}) {
  const today = parisToday();
  // Largeurs de la maquette, espacement compris ; sans intervenant, la fiche est plus étroite.
  const widths = showMember
    ? { project: 176, due: 136, deliverable: 160, costs: 150 }
    : { project: 130, due: 80, deliverable: 110, costs: 150 };
  const columns: DataTableColumn<MissionView>[] = [
    {
      key: "mission",
      header: "MISSION",
      primary: true,
      cell: (mission) => (
        <span className="block truncate text-row-primary text-ink">
          {mission.title}
          {mission.deliverableLabel ? ` · ${mission.deliverableLabel}` : ""}
        </span>
      ),
    },
    { key: "project", header: "PROJET", width: widths.project, cell: missionWork },
    ...(showMember
      ? [
          {
            key: "member",
            header: "INTERVENANT",
            width: 156,
            cell: (mission: MissionView) => (
              <span className="flex min-w-0 items-center gap-2">
                <Avatar name={mission.memberName} size={26} />
                <span className="truncate text-sm font-medium text-text">
                  {firstName(mission.memberName)}
                </span>
              </span>
            ),
          },
        ]
      : []),
    {
      key: "due",
      header: "ÉCHÉANCE",
      width: widths.due,
      cell: (mission) =>
        mission.dueOn ? (
          <span className={isMissionLate(mission, today) ? "font-medium text-danger" : undefined}>
            {formatDateShort(mission.dueOn)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "deliverable",
      header: "LIVRABLE",
      width: widths.deliverable,
      cell: (mission) => <DeliverableState mission={mission} />,
    },
    ...(showCosts
      ? [
          {
            key: "costs",
            header: "PRÉVU / ENGAGÉ",
            width: widths.costs,
            cell: (mission: MissionView) => (
              <span className="tabular">
                {formatCents(mission.plannedCostCents)} / {formatCents(mission.committedCostCents)}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <DataTable
      columns={columns}
      rows={missions}
      rowKey={(mission) => mission.id}
      rowHref={(mission) => `/equipe/missions/${mission.id}`}
      caption={caption}
      query={query}
      pagination={pagination}
      empty={empty}
    />
  );
}

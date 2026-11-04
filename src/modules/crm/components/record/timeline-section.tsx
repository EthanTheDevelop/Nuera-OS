import { ActivityList } from "@/components/ui/activity-list";
import { DataTablePagination } from "@/components/ui/data-table";
import { Tile } from "@/components/ui/tile";
import {
  ACTIVITY_KIND_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  type ActivityKind,
  type OpportunityStage,
} from "@/lib/domain-enums";
import { formatDateShort, formatTime } from "@/lib/format";
import type { Paginated } from "@/server/pagination";
import type { TimelineEntry } from "../../activity.service";
import { ActivityAddButton, type ActivityLinks } from "../activity-form";
import type { MemberOption } from "@/modules/team/team.lookup";

function stageLabel(stage: string | null) {
  return stage ? (OPPORTUNITY_STAGE_LABELS[stage as OpportunityStage] ?? stage) : null;
}

const EVENT_LABELS: Record<string, string> = {
  "quote.sent": "Devis envoyé",
  "quote.accepted": "Devis signé",
  "quote.refused": "Devis refusé",
  "project.created": "Projet créé",
  "project.delivered": "Projet livré",
  "deliverable.validated": "Livrable validé",
  "deliverable.changes_requested": "Retours demandés sur un livrable",
  "site.live": "Site mis en ligne",
  "contract.terminated": "Contrat résilié",
  "ticket.created": "Demande reçue",
  "message.received": "Message reçu",
  "invoice.paid": "Facture payée",
};

/** Une activité saisie à la journée est posée à midi UTC (`dayToInstant`) : aucune heure à montrer. */
function isDayOnly(at: Date) {
  return at.getTime() % 86_400_000 === 43_200_000;
}

function entryTitle(entry: TimelineEntry) {
  if (entry.source === "event") return EVENT_LABELS[entry.kind] ?? entry.kind;
  if (entry.source === "appointment") return `Rendez-vous · ${entry.subject}`;
  if (entry.source === "stage") {
    return `Étape ${stageLabel(entry.toStage) ?? "modifiée"} · ${entry.subject}`;
  }
  return `${ACTIVITY_KIND_LABELS[entry.kind as ActivityKind] ?? entry.kind} · ${entry.subject}`;
}

function entryDetail(entry: TimelineEntry) {
  if (entry.source === "stage") {
    const from = stageLabel(entry.fromStage);
    return from ? `Depuis ${from}` : "Création de l'affaire";
  }
  return [entry.body, entry.opportunityName ? `Affaire ${entry.opportunityName}` : null]
    .filter(Boolean)
    .join(" · ");
}

/** Historique (écran 04) : échanges, étapes, rendez-vous et événements, du plus récent au plus ancien. */
export function TimelineSection({
  timeline,
  pathname,
  query,
  links,
  members,
  canLog,
}: {
  timeline: Paginated<TimelineEntry>;
  pathname: string;
  query: Record<string, string | undefined>;
  links: ActivityLinks;
  members: readonly MemberOption[];
  canLog: boolean;
}) {
  return (
    <Tile
      icon="clock"
      title="Historique"
      aside={
        canLog ? <ActivityAddButton links={links} members={members} label="Consigner" /> : null
      }
      className="rounded-lg p-6"
    >
      <ActivityList
        items={timeline.items.map((entry) => ({
          id: `${entry.source}-${entry.id}`,
          date: isDayOnly(entry.at)
            ? formatDateShort(entry.at)
            : `${formatDateShort(entry.at)} ${formatTime(entry.at)}`,
          dateTime: entry.at.toISOString(),
          title: entryTitle(entry),
          detail: entryDetail(entry) || undefined,
          actor: entry.actorName ?? undefined,
        }))}
        empty={<p className="text-sm text-muted">Aucun échange consigné pour l&apos;instant.</p>}
        className="[&_time]:w-[104px]"
      />
      {timeline.total > timeline.pageSize ? (
        <DataTablePagination
          query={{ pathname, searchParams: query }}
          page={timeline.page}
          pageSize={timeline.pageSize}
          total={timeline.total}
        />
      ) : null}
    </Tile>
  );
}

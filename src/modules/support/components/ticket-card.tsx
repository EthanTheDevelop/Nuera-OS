import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { formatDateShort } from "@/lib/format";
import { isTicketOverdue } from "../ticket.sla";
import type { TicketRow } from "../ticket.service";
import { ClosedStamp, CloseTicketButton, TicketCardLink } from "./support-workspace";
import { dueLabel, originLabel, overdueLabel } from "./ticket-view";

const JUST_CLOSED_MS = 15_000;

/**
 * Carte de demande (Figma 11, 230 de large) : client, gravité et responsable, objet, origine ou état,
 * couverture. Dessinée ici plutôt qu'avec `KanbanCard` : l'objet vient après le client et passe à la
 * ligne, comme la maquette.
 */
export function TicketCard({
  row,
  href,
  now,
  canClose,
}: {
  row: TicketRow;
  href: string;
  now: Date;
  canClose: boolean;
}) {
  const overdue = isTicketOverdue(row, now);
  const label = `${row.number} · ${row.subject}`;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
      <p className="truncate text-row-secondary text-muted">{row.companyName}</p>
      <div className="flex flex-wrap items-center gap-1">
        <StatusBadge
          kind="severity"
          status={row.severity}
          className="transition-colors duration-(--dur-fast)"
        />
        {row.assigneeName ? (
          <Avatar name={row.assigneeName} size={22} label={row.assigneeName} />
        ) : null}
      </div>
      <p className="line-clamp-3 text-row-primary break-words text-ink">
        <TicketCardLink href={href}>{row.subject}</TicketCardLink>
      </p>
      {row.status === "closed" && row.closedAt ? (
        <ClosedStamp
          date={formatDateShort(row.closedAt)}
          justClosed={now.getTime() - row.closedAt.getTime() < JUST_CLOSED_MS}
        />
      ) : row.status === "resolved" && row.resolvedAt ? (
        <p className="text-row-secondary text-muted">
          Résolue le {formatDateShort(row.resolvedAt)}
        </p>
      ) : (
        <p className="truncate text-row-secondary text-muted">{originLabel(row)}</p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <StatusBadge kind="coverage" status={row.coverage} />
        {row.isIncident ? <Badge tone="danger">Incident</Badge> : null}
        {overdue && row.dueAt ? <Badge tone="danger">{overdueLabel(row.dueAt, now)}</Badge> : null}
      </div>
      {!overdue && row.dueAt && row.status !== "resolved" && row.status !== "closed" ? (
        <p className="text-row-secondary text-muted">{dueLabel(row.dueAt, now)}</p>
      ) : null}
      {canClose && row.status === "resolved" ? (
        <CloseTicketButton id={row.id} label={label} />
      ) : null}
    </div>
  );
}

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { KanbanCard } from "@/components/ui/kanban";
import { cn } from "@/lib/cn";
import type { OpportunityView } from "../opportunity.service";
import { amountLabel, cardSignal } from "./opportunity-view";

/** Carte d'affaire (écran 03) : client, offre, montant mono, responsable, origine, repère de suivi. */
export function PipelineCard({ opportunity }: { opportunity: OpportunityView }) {
  const signal = cardSignal(opportunity);
  const headline = opportunity.companyName ?? opportunity.name;
  const subline = opportunity.companyName
    ? opportunity.name
    : (opportunity.contactName ?? undefined);
  return (
    <KanbanCard
      href={`/pipeline/${opportunity.id}`}
      title={<span title={headline}>{headline}</span>}
      subtitle={subline ? <span title={subline}>{subline}</span> : undefined}
    >
      <div className="flex min-h-[26px] items-center justify-between gap-2">
        <span
          className={cn(
            "tabular min-w-0 truncate font-mono text-cell",
            opportunity.amountCents === null ? "text-muted" : "text-text",
          )}
        >
          {amountLabel(opportunity.amountCents)}
        </span>
        {opportunity.ownerName ? (
          <Avatar name={opportunity.ownerName} size={26} label={opportunity.ownerName} />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {opportunity.source ? (
          <span className="flex max-w-full min-w-0" title={opportunity.source}>
            <Badge className="max-w-full truncate">{opportunity.source}</Badge>
          </span>
        ) : null}
        <span
          className={cn(
            "flex min-w-0 items-center gap-1 text-xs",
            signal.tone === "warn" && "text-warn",
            signal.tone === "danger" && "text-danger",
            signal.tone === "muted" && "text-muted",
          )}
        >
          <Icon name="clock" size={14} className="shrink-0" />
          <span className="truncate" title={signal.label}>
            {signal.label}
          </span>
        </span>
      </div>
    </KanbanCard>
  );
}

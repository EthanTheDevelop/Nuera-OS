import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { KanbanBoard, KanbanCard } from "@/components/ui/kanban";
import { demoMove } from "./actions";
import { KANBAN_CARDS, KANBAN_COLUMNS } from "./fixtures";

/** Cartes rendues côté serveur et Server Action en `onMove`, comme le fera le lot Ventes. */
export function KanbanDemo() {
  return (
    <KanbanBoard
      label="Pipeline de démonstration"
      columns={KANBAN_COLUMNS}
      onMove={demoMove}
      items={KANBAN_CARDS.map((card) => ({
        id: card.id,
        columnId: card.columnId,
        label: card.client,
        card: (
          <KanbanCard title={card.client} subtitle={card.offer} href="/dev/ui/clients">
            <div className="flex items-center gap-1">
              <p className="min-w-0 flex-1 font-mono text-counter text-ink">{card.amount}</p>
              <Avatar name={card.owner} size={26} />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Badge>{card.source}</Badge>
              <span className="flex items-center gap-1 text-[11px] leading-[1.25] text-muted">
                <Icon name="clock" size={12} />
                {card.delay}
              </span>
            </div>
          </KanbanCard>
        ),
      }))}
    />
  );
}

import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import type { KanbanColumnDef, KanbanItem } from "@/components/ui/kanban";
import { cn } from "@/lib/cn";

const DOT: Record<NonNullable<KanbanColumnDef["tone"]>, string> = {
  accent: "bg-accent",
  warn: "bg-warn",
  success: "bg-success",
  chatgpt: "bg-chatgpt",
  danger: "bg-danger",
  neutral: "bg-muted",
};

/**
 * Le même tableau pour qui lit sans pouvoir déplacer (lecture, prestataire) : `KanbanBoard` n'a pas
 * de mode sans glisser-déposer, et une carte qui se prend sans pouvoir se poser tromperait.
 */
export function ReadonlyBoard({
  columns,
  items,
}: {
  columns: readonly KanbanColumnDef[];
  items: readonly KanbanItem[];
}) {
  return (
    <div
      role="group"
      aria-label="Demandes par état"
      className="relative flex [scrollbar-width:thin] gap-(--grid-gap) overflow-x-auto pb-4 lg:min-h-[calc(100dvh-198px)]"
    >
      {columns.map((column) => {
        const cards = items.filter((item) => item.columnId === column.id);
        return (
          <section
            key={column.id}
            aria-labelledby={`support-column-${column.id}`}
            className="anim-content flex w-[min(280px,82vw)] shrink-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:w-auto sm:min-w-[206px] sm:flex-1"
          >
            <header className="flex items-center gap-2 px-1">
              <span
                aria-hidden="true"
                className={cn("size-2 rounded-full", DOT[column.tone ?? "accent"])}
              />
              <h3
                id={`support-column-${column.id}`}
                className="min-w-0 flex-1 truncate text-tile-title text-ink"
              >
                {column.title}
              </h3>
              <span className="tabular font-mono text-xs leading-[1.25] font-medium text-muted">
                {cards.length}
              </span>
            </header>
            <ul className="flex min-h-12 flex-col gap-3">
              {cards.map((item) => (
                <li key={item.id} className="relative rounded-md">
                  {item.card}
                </li>
              ))}
            </ul>
            {column.addHref ? (
              <Link
                href={column.addHref}
                className="hit-44 flex items-center gap-1 self-start rounded-sm py-2 pl-2 text-cell font-medium text-muted hover:text-text"
              >
                <Icon name="plus" size={14} />
                {column.addLabel}
              </Link>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

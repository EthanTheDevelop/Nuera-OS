import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Avatar } from "./avatar";

export interface ActivityEntry {
  id: string;
  /** Date ou heure déjà formatée (`12 oct.`), en mono. */
  date: string;
  /** Instant lisible par machine (`AAAA-MM-JJ`), pour l'élément `<time>`. */
  dateTime?: string;
  title: ReactNode;
  detail?: ReactNode;
  /** Auteur : affiche un avatar 22 à droite. */
  actor?: string;
}

/**
 * Historique (écrans 04, 20) : date mono, événement, détail. Compatible serveur.
 * Vide : ne rend que `empty`.
 */
export function ActivityList({
  items,
  empty,
  className,
}: {
  items: readonly ActivityEntry[];
  empty?: ReactNode;
  className?: string;
}) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <ol className={cn("flex flex-col gap-3", className)}>
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3">
          <time
            dateTime={item.dateTime}
            className="w-16 shrink-0 pt-px font-mono text-amount-compact text-muted"
          >
            {item.date}
          </time>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">{item.title}</p>
            {item.detail ? <p className="mt-0.5 text-xs text-muted">{item.detail}</p> : null}
          </div>
          {item.actor ? <Avatar name={item.actor} size={22} label={item.actor} /> : null}
        </li>
      ))}
    </ol>
  );
}

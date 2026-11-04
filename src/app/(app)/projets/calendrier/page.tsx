import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import { paramValue, type SearchParamsLike } from "@/lib/url-state";
import { addDays, parisDay } from "@/modules/projects/project.rules";
import { listCalendarEntries, type CalendarEntry } from "@/modules/projects/task.service";
import { canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Calendrier des projets" };

const WEEK_DAYS = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."];

const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const KIND_CLASS: Record<CalendarEntry["kind"], string> = {
  go_live: "bg-success-pale text-success",
  phase: "bg-accent-pale text-accent",
  task: "bg-surface-raised text-text",
};

const KIND_LABEL: Record<CalendarEntry["kind"], string> = {
  go_live: "Mise en ligne",
  phase: "Jalon",
  task: "Tâche",
};

/** Un mois illisible ou hors de portée dans l'adresse ramène au mois courant. */
function parseMonth(value: string | undefined, today: string): { year: number; month: number } {
  const asked = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(value ?? "");
  const match = asked ?? /^(\d{4})-(\d{2})/.exec(today);
  return { year: Number(match?.[1]), month: Number(match?.[2]) };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(year: number, month: number, delta: number): string {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return monthKey(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

function EntryLink({ entry }: { entry: CalendarEntry }) {
  return (
    <Link
      href={entry.href}
      title={`${KIND_LABEL[entry.kind]} · ${entry.title} · ${entry.projectLabel}`}
      className={cn(
        "block truncate rounded-sm px-1.5 py-0.5 text-xs hover:brightness-95",
        KIND_CLASS[entry.kind],
        entry.done && "line-through opacity-60",
      )}
    >
      {entry.title}
      <span className="opacity-70"> · {entry.projectLabel.split(" · ")[0]}</span>
    </Link>
  );
}

/** « Vue calendrier » de l'écran 08 : mois en grille, en agenda sur un écran étroit. */
export default async function ProjectsCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!canAny(ctx.actor, ["projects:read", "projects:read_assigned"])) return <ForbiddenState />;

  const raw = (await searchParams) as SearchParamsLike;
  const today = parisDay();
  const { year, month } = parseMonth(paramValue(raw, "mois"), today);
  const first = `${monthKey(year, month)}-01`;
  const last = addDays(`${shiftMonth(year, month, 1)}-01`, -1);
  const entries = await listCalendarEntries(ctx, { from: first, to: last });

  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
  }

  // La grille commence au lundi de la première semaine du mois et finit le dimanche de la dernière.
  const weekdayOfFirst = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -weekdayOfFirst);
  const weekdayOfLast = (new Date(`${last}T00:00:00Z`).getUTCDay() + 6) % 7;
  const end = addDays(last, 6 - weekdayOfLast);
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);

  const title = MONTH_LABEL.format(new Date(`${first}T00:00:00Z`));
  const agendaDays = [...byDay.keys()].sort();

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        title="Calendrier des projets"
        subtitle={`${entries.length} échéance${entries.length > 1 ? "s" : ""} en ${title}`}
        className="mb-0 lg:mb-0"
        actions={<ButtonLink href="/projets">Vue liste</ButtonLink>}
      />

      <section
        aria-label={`Échéances de ${title}`}
        className="anim-content flex flex-col gap-4 rounded-lg bg-surface p-4 shadow-soft sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/projets/calendrier?mois=${shiftMonth(year, month, -1)}`}
            aria-label="Mois précédent"
            className="hit-44 rounded-sm text-muted hover:text-text"
          >
            <Icon name="chevron" size={16} className="rotate-180" />
          </Link>
          <h2 className="text-tile-title text-ink first-letter:uppercase">{title}</h2>
          <Link
            href={`/projets/calendrier?mois=${shiftMonth(year, month, 1)}`}
            aria-label="Mois suivant"
            className="hit-44 rounded-sm text-muted hover:text-text"
          >
            <Icon name="chevron" size={16} />
          </Link>
        </div>

        <div className="hidden grid-cols-7 gap-px overflow-hidden rounded-md bg-border md:grid">
          {WEEK_DAYS.map((label) => (
            <div
              key={label}
              className="bg-surface px-2 py-2 font-mono text-table-head text-muted uppercase"
            >
              {label}
            </div>
          ))}
          {days.map((day) => {
            const inMonth = day >= first && day <= last;
            const items = byDay.get(day) ?? [];
            return (
              <div key={day} className="flex min-h-24 min-w-0 flex-col gap-1 bg-surface p-1.5">
                <span
                  className={cn(
                    "tabular text-xs",
                    day === today ? "font-semibold text-accent" : "text-muted",
                    !inMonth && "opacity-40",
                  )}
                >
                  {Number(day.slice(8))}
                </span>
                {items.slice(0, 4).map((entry) => (
                  <EntryLink key={entry.id} entry={entry} />
                ))}
                {items.length > 4 ? (
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer rounded-sm hover:text-text focus-visible:outline-2 focus-visible:outline-focus">
                      +{items.length - 4}
                    </summary>
                    <div className="mt-1 flex flex-col gap-1">
                      {items.slice(4).map((entry) => (
                        <EntryLink key={entry.id} entry={entry} />
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-4 md:hidden">
          {agendaDays.map((day) => (
            <div key={day} className="flex flex-col gap-1">
              <h3
                className={cn("text-sm font-medium", day === today ? "text-accent" : "text-text")}
              >
                {formatDateShort(day)}
              </h3>
              {(byDay.get(day) ?? []).map((entry) => (
                <EntryLink key={entry.id} entry={entry} />
              ))}
            </div>
          ))}
        </div>

        {entries.length === 0 ? (
          <EmptyState
            compact
            icon="calendar"
            title="Aucune échéance ce mois-ci"
            description="Les jalons, les tâches et les mises en ligne datés apparaissent ici."
          />
        ) : null}

        <ul className="flex flex-wrap gap-4 text-xs text-muted">
          {(Object.keys(KIND_LABEL) as CalendarEntry["kind"][]).map((kind) => (
            <li key={kind} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("size-3 rounded-sm", KIND_CLASS[kind])} />
              {KIND_LABEL[kind]}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

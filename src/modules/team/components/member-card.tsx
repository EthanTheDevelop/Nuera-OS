import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Gauge, loadTone } from "@/components/ui/gauge";
import { formatDateShort, formatDays, formatNumber, MINUTES_PER_DAY } from "@/lib/format";
import type { MemberCard as MemberCardData } from "../team.service";

const SKILL_LIMIT = 4;

/** Une fiche de l'écran 22 (552 × 214) : qui, compétences, disponibilité du mois. Lien vers sa fiche. */
export function MemberCard({ card, index }: { card: MemberCardData; index: number }) {
  const { member, capacity, absences } = card;
  const skills = member.skills ?? [];
  const planned = capacity?.plannedMinutes ?? 0;
  const available = capacity?.capacityMinutes ?? 0;
  const percent = capacity?.loadPercent ?? 0;

  return (
    <article
      style={{ "--i": index } as React.CSSProperties}
      className="anim-content relative flex min-w-0 flex-col gap-3 rounded-lg bg-surface p-6 shadow-soft transition-shadow duration-(--dur-fast) hover:shadow-float"
    >
      <header className="flex min-w-0 items-center gap-4">
        <Avatar name={member.fullName} size={56} />
        <div className="min-w-0">
          <h2 className="text-client-card-title text-ink">
            <Link
              href={`/equipe/${member.id}`}
              className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
            >
              {member.fullName}
            </Link>
          </h2>
          {member.title ? <p className="truncate text-sm text-muted">{member.title}</p> : null}
        </div>
      </header>

      {skills.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Compétences">
          {skills.slice(0, SKILL_LIMIT).map((skill) => (
            <li key={skill}>
              <Badge tone="accent">{skill}</Badge>
            </li>
          ))}
          {skills.length > SKILL_LIMIT ? (
            <li>
              <Badge tone="neutral">+{skills.length - SKILL_LIMIT}</Badge>
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 text-sm text-text">
          <span>Disponibilité</span>
          <span className="tabular">
            {capacity ? `${formatDays(available)} / mois` : "Non renseignée"}
          </span>
        </div>
        <Gauge
          value={Math.min(percent, 100)}
          height={8}
          tone={loadTone(percent)}
          label={`Charge de ${member.fullName} ce mois-ci`}
          valueText={capacity?.loadPercent === null ? "Pas de capacité" : `${percent} %`}
          index={index}
        />
        <p className="tabular text-xs text-muted">
          Ce mois : {formatNumber(planned / MINUTES_PER_DAY, 1)} /{" "}
          {formatNumber(available / MINUTES_PER_DAY, 1)} j vendues
          {available > 0 && planned > available
            ? ` · surcharge de ${formatNumber((planned - available) / MINUTES_PER_DAY, 1)} j`
            : ""}
          {absences[0]
            ? ` · absence du ${formatDateShort(absences[0].startOn)} au ${formatDateShort(absences[0].endOn)}`
            : ""}
        </p>
      </div>
    </article>
  );
}

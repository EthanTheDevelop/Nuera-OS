import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { formatDateShort } from "@/lib/format";
import { formatCentsHT } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { AppointmentView } from "@/modules/appointments/appointment.service";
import { formatPanelDateTime } from "../messaging.format";

export interface PanelProject {
  id: string;
  offer: string;
  budgetCents: number | null;
  /** Acompte du devis d'origine ; absent sans devis ou sans droit de lecture des devis. */
  deposit: { percent: number; paid: boolean } | null;
  dueOn: string | null;
  memberNames: readonly string[];
  requirements: readonly { id: string; label: string; received: boolean }[];
}

function PanelHeading({ children }: { children: ReactNode }) {
  return <h3 className="font-mono text-table-head font-normal text-muted uppercase">{children}</h3>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-row-secondary text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-row-secondary font-semibold text-ink">{children}</dd>
    </div>
  );
}

function joinNames(names: readonly string[]): string {
  const firstNames = names.map((name) => name.trim().split(/\s+/)[0] ?? name);
  if (firstNames.length < 2) return firstNames.join("");
  return `${firstNames.slice(0, -1).join(", ")} et ${firstNames[firstNames.length - 1]}`;
}

/**
 * Panneau client (Figma 63:628) : projet, contenus attendus, prochain rendez-vous. Chaque bloc n'est
 * rendu que si sa source a une valeur : aucune ligne vide ni valeur inventée.
 */
export function ClientPanel({
  project,
  nextAppointment,
  scheduleAction,
  footer,
  className,
}: {
  project: PanelProject | null;
  nextAppointment: AppointmentView | null;
  scheduleAction?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {project ? (
        <section className="flex flex-col gap-5">
          <PanelHeading>Projet</PanelHeading>
          <dl className="flex flex-col gap-5">
            <Row label="Offre">
              <Link href={`/projets/${project.id}`} className="underline-offset-4 hover:underline">
                {project.offer}
              </Link>
            </Row>
            {project.budgetCents !== null ? (
              <Row label="Montant">{formatCentsHT(project.budgetCents)}</Row>
            ) : null}
            {project.deposit ? (
              <Row label={`Acompte ${project.deposit.percent} %`}>
                {project.deposit.paid ? "payé" : "à venir"}
              </Row>
            ) : null}
            {project.dueOn ? (
              <Row label="Mise en ligne">{formatDateShort(project.dueOn)}</Row>
            ) : null}
            {project.memberNames.length > 0 ? (
              <Row label="Équipe">{joinNames(project.memberNames)}</Row>
            ) : null}
          </dl>
        </section>
      ) : null}

      {project && project.requirements.length > 0 ? (
        <section className="flex flex-col gap-3">
          <PanelHeading>Contenus attendus</PanelHeading>
          <ul className="flex flex-col gap-2.5">
            {project.requirements.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-row-secondary text-text">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-[18px] shrink-0 items-center justify-center rounded-full",
                    item.received ? "bg-success-pale text-success" : "bg-warn-pale text-warn",
                  )}
                >
                  <Icon name={item.received ? "check" : "clock"} size={12} />
                </span>
                <span className="min-w-0">{item.label}</span>
                <span className="sr-only">{item.received ? "reçu" : "attendu"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <PanelHeading>Prochain rendez-vous</PanelHeading>
        {nextAppointment ? (
          <p className="flex items-start gap-2 text-row-secondary text-text">
            <Icon name="calendar" size={16} className="mt-px shrink-0 text-accent" />
            <span className="min-w-0">
              {nextAppointment.title} · {formatPanelDateTime(nextAppointment.startsAt)}
            </span>
          </p>
        ) : (
          <p className="text-row-secondary text-muted">Aucun rendez-vous prévu.</p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {scheduleAction}
          <Link
            href="/messages/rendez-vous"
            className="hit-44 text-compact-button text-accent underline-offset-4 hover:underline"
          >
            Tous les rendez-vous
          </Link>
        </div>
      </section>

      {footer ? <div className="border-t border-border pt-4">{footer}</div> : null}
    </div>
  );
}

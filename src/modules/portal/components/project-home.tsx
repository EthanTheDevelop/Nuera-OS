import type { ReactNode } from "react";
import { PortalCard } from "@/components/portal/portal-card";
import { EmptyState } from "@/components/states/states";
import { AvatarStack } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CompactLink } from "@/components/ui/compact-button";
import { Gauge } from "@/components/ui/gauge";
import { Icon } from "@/components/ui/icon";
import { StepTimeline, type TimelineStep } from "@/components/ui/step-timeline";
import { formatDateLong, formatDateShort, formatRelativeDate, formatTime } from "@/lib/format";
import { formatCents, ratioPercent } from "@/lib/money";
import { documentPreviewHref, isPreviewable } from "@/modules/documents/document.format";
import { deliveryPromise, formatDayMonth, joinNames } from "../portal.format";
import type { PortalDeliverableView, PortalProjectHome } from "../portal.service";
import { DeliverableReviewActions } from "./deliverable-review";
import { RequirementAction } from "./requirement-action";

const lowerFirst = (value: string) => value.charAt(0).toLocaleLowerCase("fr-FR") + value.slice(1);

function phaseDetail(
  phase: PortalProjectHome["project"]["phases"][number],
  stepLabel: string | null,
) {
  if (phase.state === "done") {
    return phase.doneOn ? `Fait le ${formatDateShort(phase.doneOn)}` : "Fait";
  }
  if (phase.state === "current") {
    return stepLabel && stepLabel !== phase.name
      ? `En cours · ${lowerFirst(stepLabel)}`
      : "En cours";
  }
  return phase.dueOn ? `Prévu le ${formatDateShort(phase.dueOn)}` : "À venir";
}

function chapo(home: PortalProjectHome): string {
  const { project } = home;
  if (project.stage === "closed") return `${project.name} est terminé. Merci pour votre confiance.`;
  if (project.stage === "delivered") {
    return `${project.name} est livré. Vos documents restent ici, et nous restons à votre écoute.`;
  }
  const step = project.stepLabel ? ` En ce moment : ${lowerFirst(project.stepLabel)}.` : "";
  const expected = project.requirements.find((item) => item.status === "expected");
  const missing = expected
    ? ` Il nous manque encore : ${lowerFirst(expected.label)}.`
    : home.deliverables.some((item) => item.status === "to_validate")
      ? " Une version attend votre avis."
      : "";
  return project.stage === "starting"
    ? `${project.name} démarre.${missing}`
    : `${project.name} avance.${step}${missing}`;
}

function Hero({
  home,
  greeting,
  now,
}: {
  home: PortalProjectHome;
  greeting: ReactNode;
  now: Date;
}) {
  const { project } = home;
  const promise =
    project.dueOn && !project.deliveredOn ? deliveryPromise(project.dueOn, now) : null;
  return (
    <header className="flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-[640px] min-w-0">
        <h1 className="text-[32px] leading-[1.25] font-bold text-ink sm:text-[44px]">{greeting}</h1>
        <p className="mt-2 text-lg leading-[1.4] font-normal text-muted">{chapo(home)}</p>
      </div>
      {project.deliveredOn ? (
        <div className="sm:text-right">
          <p className="text-sm text-muted">Mise en ligne</p>
          <p className="text-[28px] leading-[1.25] font-bold text-ink sm:text-[36px]">
            {formatDayMonth(project.deliveredOn)}
          </p>
        </div>
      ) : project.dueOn && promise ? (
        <div className="sm:text-right">
          <p className="text-sm text-muted">Mise en ligne prévue</p>
          <p className="text-[28px] leading-[1.25] font-bold text-ink sm:text-[36px]">
            {formatDayMonth(project.dueOn)}
          </p>
          <p
            className={`mt-1 flex items-center gap-2 text-sm sm:justify-end ${promise.onTime ? "text-success" : "text-warn"}`}
          >
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${promise.onTime ? "bg-success" : "bg-warn"}`}
            />
            {promise.label}
          </p>
        </div>
      ) : null}
    </header>
  );
}

function PathCard({ home }: { home: PortalProjectHome }) {
  const { phases, stepLabel } = home.project;
  if (phases.length === 0) {
    return (
      <PortalCard title="Le chemin de votre projet">
        <EmptyState
          compact
          icon="flag"
          title="Les grandes étapes arrivent"
          description="Nous les préparons et les afficherons ici dès qu'elles seront fixées."
        />
      </PortalCard>
    );
  }
  const currentIndex = phases.findIndex((phase) => phase.state === "current");
  const doneCount = phases.filter((phase) => phase.state === "done").length;
  const position = currentIndex >= 0 ? currentIndex + 1 : Math.min(doneCount + 1, phases.length);
  const steps: TimelineStep[] = phases.map((phase) => ({
    id: phase.id,
    title: phase.name,
    detail: phaseDetail(phase, stepLabel),
    state: phase.state,
  }));
  return (
    <PortalCard
      title="Le chemin de votre projet"
      aside={`Étape ${position} sur ${phases.length}`}
      className="gap-5"
    >
      <StepTimeline variant="client" steps={steps} label="Avancement du projet" />
    </PortalCard>
  );
}

/** Note C3 : un contenu qui vient d'arriver passe à « reçu » avec une coche qui se dessine. */
const JUST_RECEIVED_MS = 60_000;

function ContentsCard({
  home,
  readOnly,
  now,
}: {
  home: PortalProjectHome;
  readOnly: boolean;
  now: Date;
}) {
  const { requirements, id: projectId } = home.project;
  const expected = requirements.filter((item) => item.status === "expected");
  if (requirements.length === 0) return null;
  return (
    <PortalCard
      id="a-vous"
      title="À vous de jouer"
      description={
        expected.length > 0
          ? "S'ils arrivent plus tard, la mise en ligne recule d'autant, et nous vous le disons tout de suite."
          : "Tout est bien reçu, merci. Rien d'autre à faire pour l'instant."
      }
    >
      <ul className="flex flex-col">
        {requirements.map((item, index) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border py-4 last:pb-0"
          >
            {item.status === "received" ? (
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-paper ${
                  item.receivedAt && now.getTime() - item.receivedAt.getTime() < JUST_RECEIVED_MS
                    ? "anim-pop"
                    : ""
                }`}
              >
                <Icon name="check" size={12} />
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="ml-1.5 size-2 shrink-0 rounded-full bg-en-cours"
              />
            )}
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-base font-semibold text-ink">{item.label}</p>
              <p
                className={`text-sm ${item.status === "expected" && item.dueOn ? "text-warn" : "text-muted"}`}
              >
                {item.status === "received"
                  ? item.receivedAt
                    ? `Reçu le ${formatDateShort(item.receivedAt)}`
                    : "Reçu"
                  : item.dueOn
                    ? `À déposer avant le ${formatDateLong(item.dueOn).replace(/ \d{4}$/, "")}`
                    : "À compléter quand vous voulez"}
              </p>
            </div>
            {item.status === "expected" && !readOnly ? (
              <RequirementAction
                requirementId={item.id}
                label={item.label}
                projectId={projectId}
                primary={index === requirements.findIndex((row) => row.status === "expected")}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </PortalCard>
  );
}

const APPOINTMENT_DAY = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "long",
});
const APPOINTMENT_MONTH = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  month: "short",
});
const APPOINTMENT_DATE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "numeric",
});

function AppointmentCard({ home, readOnly }: { home: PortalProjectHome; readOnly: boolean }) {
  const appointment = home.nextAppointment;
  if (!appointment) {
    return (
      <PortalCard title="Prochain rendez-vous">
        <p className="text-sm text-muted">Aucun rendez-vous prévu pour l&apos;instant.</p>
        {readOnly ? null : (
          <div>
            <CompactLink
              variant="secondary"
              icon="calendar"
              href={`/espace/messages?brouillon=${encodeURIComponent("Bonjour, je souhaiterais fixer un rendez-vous. Je vous propose : ")}`}
            >
              Proposer un rendez-vous
            </CompactLink>
          </div>
        )}
      </PortalCard>
    );
  }
  const weekday = APPOINTMENT_DAY.format(appointment.startsAt);
  const draft = `Bonjour, pourrions-nous déplacer le rendez-vous « ${appointment.title} » du ${formatDateShort(appointment.startsAt)} ? Je vous propose : `;
  return (
    <PortalCard title="Prochain rendez-vous" className="gap-5">
      <div className="flex items-center gap-4">
        <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-md bg-accent-pale text-accent">
          <span className="text-xs leading-[1.25]">
            {APPOINTMENT_MONTH.format(appointment.startsAt)}
          </span>
          <span className="text-xl leading-[1.25] font-bold text-ink">
            {APPOINTMENT_DATE.format(appointment.startsAt)}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink">
            {weekday.charAt(0).toLocaleUpperCase("fr-FR") + weekday.slice(1)} ·{" "}
            {formatTime(appointment.startsAt)}
          </p>
          <p className="text-sm text-muted">
            {[appointment.title, `${appointment.durationMinutes} min`, appointment.channel]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <CompactLink
            variant="secondary"
            icon="calendar"
            href={`/espace/rendez-vous/${appointment.id}/agenda`}
            prefetch={false}
            download
          >
            Ajouter à mon agenda
          </CompactLink>
          <CompactLink
            variant="quiet"
            icon="edit"
            href={`/espace/messages?brouillon=${encodeURIComponent(draft)}`}
          >
            Déplacer
          </CompactLink>
        </div>
      )}
    </PortalCard>
  );
}

function roundsNote(item: PortalDeliverableView): string | null {
  if (item.feedbackRoundsIncluded <= 0) return null;
  const left = item.feedbackRoundsIncluded - item.feedbackRoundsUsed;
  const included = `${item.feedbackRoundsIncluded} tour${item.feedbackRoundsIncluded > 1 ? "s" : ""} de retours inclus`;
  if (left <= 0) return `${included} · utilisés, le prochain sera étudié avec vous`;
  return `${included} · il vous en reste ${left}`;
}

/** Aperçu dans un cadre de navigateur : l'image si le navigateur peut l'afficher, sinon un lien. */
function DeliverablePreview({ item }: { item: PortalDeliverableView }) {
  const { document } = item;
  const image =
    document?.mimeType?.startsWith("image/") && isPreviewable(document.mimeType)
      ? documentPreviewHref(document.id)
      : null;
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2.5">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-border" />
        <span aria-hidden="true" className="size-1.5 rounded-full bg-border" />
        <span aria-hidden="true" className="size-1.5 rounded-full bg-border" />
        <span className="min-w-0 flex-1 truncate text-center font-mono text-xs text-muted">
          {document?.filename ?? "Fichier à venir"}
        </span>
      </div>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- aperçu authentifié, hors optimiseur
        <img src={image} alt={`Aperçu : ${item.title}`} className="block h-auto w-full" />
      ) : (
        <div className="flex min-h-40 flex-col items-center justify-center gap-3 bg-surface-raised p-6 text-center">
          <Icon name="devis" size={24} className="text-accent" />
          {document ? (
            <CompactLink
              variant="secondary"
              icon="link"
              href={documentPreviewHref(document.id)}
              prefetch={false}
              target="_blank"
              rel="noopener"
            >
              Ouvrir la version {item.version}
            </CompactLink>
          ) : (
            <p className="text-sm text-muted">Le fichier vous sera partagé ici.</p>
          )}
        </div>
      )}
    </div>
  );
}

function DeliverableCard({
  item,
  projectId,
  readOnly,
}: {
  item: PortalDeliverableView;
  projectId: string;
  readOnly: boolean;
}) {
  const note = roundsNote(item);
  return (
    <PortalCard title={item.title} className="gap-4">
      <p className="-mt-2 text-sm text-muted">
        Version {item.version} · reçue {formatRelativeDate(item.updatedAt)}
      </p>
      <DeliverablePreview item={item} />
      {readOnly ? null : (
        <DeliverableReviewActions
          deliverableId={item.id}
          projectId={projectId}
          version={item.version}
          title={item.title}
        />
      )}
      {note ? <p className="text-sm text-muted">{note}</p> : null}
    </PortalCard>
  );
}

function ReviewedCard({ items }: { items: readonly PortalDeliverableView[] }) {
  if (items.length === 0) return null;
  return (
    <PortalCard title="Vos retours">
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">
                {item.title} · version {item.version}
              </p>
              {item.decidedAt ? (
                <p className="text-xs text-muted">{formatDateShort(item.decidedAt)}</p>
              ) : null}
            </div>
            {item.status === "validated" ? (
              <Badge tone="accent">Validée</Badge>
            ) : (
              <Badge tone="warn">Retours envoyés</Badge>
            )}
          </li>
        ))}
      </ul>
    </PortalCard>
  );
}

function PaymentsCard({ home }: { home: PortalProjectHome }) {
  if (!home.payments) {
    return (
      <PortalCard title="Paiements">
        <p className="text-sm text-muted">
          Le client voit ici ce qu&apos;il a réglé. Ces montants sont réservés aux personnes qui ont
          accès aux finances.
        </p>
      </PortalCard>
    );
  }
  const { paidCents, totalCents, remainingCents, items } = home.payments;
  if (totalCents === null) {
    return (
      <PortalCard title="Paiements">
        <p className="text-sm text-muted">Les échéances de ce projet s&apos;afficheront ici.</p>
      </PortalCard>
    );
  }
  const percent = ratioPercent(paidCents, totalCents) ?? 0;
  const next = items.find((item) => item.status !== "paid");
  return (
    <PortalCard title="Paiements">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-figure font-bold text-ink">{formatCents(paidCents)}</span>
        <span className="text-sm text-muted">réglés sur {formatCents(totalCents)} HT</span>
      </p>
      <Gauge
        value={percent}
        tone="success"
        height={8}
        label="Part réglée"
        valueText={`${percent} %`}
        className="max-w-[300px]"
      />
      <p className="text-sm text-muted">
        {remainingCents === 0
          ? "Tout est réglé, merci."
          : next
            ? `Prochaine échéance : ${next.label}, ${formatCents(next.amountCents)} HT${next.dueOn ? `, le ${formatDateShort(next.dueOn).replace(/\.$/, "")}` : ""}.`
            : `Reste à régler : ${formatCents(remainingCents ?? 0)} HT.`}
      </p>
    </PortalCard>
  );
}

function InterlocutorsCard({ home, readOnly }: { home: PortalProjectHome; readOnly: boolean }) {
  const people = home.project.interlocutors;
  return (
    <PortalCard title="Vos interlocuteurs" className="gap-4">
      {people.length > 0 ? (
        <div className="flex items-center gap-3">
          <AvatarStack people={people.map((person) => ({ name: person.fullName }))} />
          <div className="min-w-0">
            <p className="text-base font-semibold text-ink">
              {joinNames(people.map((person) => person.fullName))}
            </p>
            <p className="text-sm text-muted">
              {people.length > 1 ? "Celles et ceux" : "La personne"} qui s&apos;occupe
              {people.length > 1 ? "nt" : ""} de votre projet
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">L&apos;équipe de Nuera Studio répond à vos messages.</p>
      )}
      {readOnly ? null : (
        <div>
          <CompactLink variant="secondary" icon="messages" href="/espace/messages">
            Écrire un message
          </CompactLink>
        </div>
      )}
    </PortalCard>
  );
}

/**
 * Écran C3. `readOnly` retire toute action : c'est l'aperçu de l'agence, qui réutilise ces sections.
 * Compatible serveur : seules les actions du client sont des composants client.
 */
export function ProjectHome({
  home,
  greeting,
  switcher,
  readOnly = false,
  now,
}: {
  home: PortalProjectHome;
  greeting: ReactNode;
  switcher?: ReactNode;
  readOnly?: boolean;
  now: Date;
}) {
  const toValidate = home.deliverables.filter((item) => item.status === "to_validate");
  const reviewed = home.deliverables.filter((item) => item.status !== "to_validate");
  return (
    <div className="flex flex-col gap-6">
      {switcher}
      <Hero home={home} greeting={greeting} now={now} />
      <PathCard home={home} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,856fr)_minmax(0,480fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <ContentsCard home={home} readOnly={readOnly} now={now} />
          <AppointmentCard home={home} readOnly={readOnly} />
        </div>
        <div id="a-valider" className="flex min-w-0 scroll-mt-28 flex-col gap-6">
          {toValidate.length > 0 ? (
            toValidate.map((item) => (
              <DeliverableCard
                key={item.id}
                item={item}
                projectId={home.project.id}
                readOnly={readOnly}
              />
            ))
          ) : reviewed.length === 0 ? (
            <PortalCard title="À valider">
              <p className="text-sm text-muted">
                Rien pour l&apos;instant. Les maquettes à valider arriveront ici.
              </p>
            </PortalCard>
          ) : null}
          <ReviewedCard items={reviewed} />
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <PaymentsCard home={home} />
        <InterlocutorsCard home={home} readOnly={readOnly} />
      </div>
    </div>
  );
}

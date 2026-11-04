"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { SearchField } from "@/components/ui/filter-bar";
import {
  Checkbox,
  Field,
  FormAlert,
  Input,
  Select,
  SelectField,
  TextField,
} from "@/components/ui/form";
import { DurationField } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { fieldError, IDLE_ACTION_STATE } from "@/lib/action-state";
import {
  loadAppointmentLinksAction,
  saveAppointmentAction,
  searchAppointmentCompaniesAction,
} from "../appointment.actions";

export interface AppointmentFormDefaults {
  id?: string;
  source?: "manual" | "cal";
  title?: string;
  kind?: string | null;
  startsAt?: Date | null;
  durationMinutes?: number;
  channel?: string | null;
  location?: string | null;
  company?: { id: string; name: string } | null;
  contactId?: string | null;
  projectId?: string | null;
  opportunityId?: string | null;
  memberIds?: readonly string[];
}

interface LinkOptions {
  contacts: { id: string; fullName: string }[];
  projects: { id: string; name: string; number: string }[];
  opportunities: { id: string; name: string }[];
}

const NO_LINKS: LinkOptions = { contacts: [], projects: [], opportunities: [] };

/** Valeur d'un `datetime-local`, à l'heure de l'appareil : ce que la personne saisit et relit. */
function toLocalInput(date: Date | null | undefined): string {
  if (!date) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Heure saisie vers ISO. Une année à six chiffres donne une date invalide : le champ reste vide. */
function toIso(local: string): string {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** Rendez-vous, en création ou en modification. Le bouton appartient à la fenêtre. */
export function AppointmentFormButton({
  label,
  variant = "quiet",
  members,
  defaults = {},
  accent = false,
}: {
  label: string;
  variant?: "primary" | "secondary" | "quiet";
  members: readonly { id: string; name: string }[];
  defaults?: AppointmentFormDefaults;
  /** Action principale de l'en-tête de page : le grand bouton du Design System. */
  accent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {accent ? (
        <Button variant="accent" icon="plus" onClick={() => setOpen(true)}>
          {label}
        </Button>
      ) : (
        <CompactButton variant={variant} onClick={() => setOpen(true)}>
          {label}
        </CompactButton>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={defaults.id ? "Modifier le rendez-vous" : "Nouveau rendez-vous"}
        width={600}
      >
        <AppointmentForm members={members} defaults={defaults} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function AppointmentForm({
  members,
  defaults,
  onClose,
}: {
  members: readonly { id: string; name: string }[];
  defaults: AppointmentFormDefaults;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, submitting] = useActionState(
    saveAppointmentAction.bind(null, defaults.id ?? null),
    IDLE_ACTION_STATE,
  );
  const [, startSubmit] = useTransition();
  useActionToast(state);
  const [requestId] = useState(() => globalThis.crypto?.randomUUID?.() ?? "");
  const [startsLocal, setStartsLocal] = useState(toLocalInput(defaults.startsAt));
  const [search, setSearch] = useState("");
  const [companies, setCompanies] = useState(defaults.company ? [defaults.company] : []);
  const [companyId, setCompanyId] = useState(defaults.company?.id ?? "");
  const [links, setLinks] = useState<LinkOptions>(NO_LINKS);
  const [loadingLinks, startLoadingLinks] = useTransition();
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (state.status !== "success") return;
    onClose();
    router.refresh();
    // Ne réagit qu'au résultat de l'action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (!defaults.company) void searchAppointmentCompaniesAction("").then(setCompanies);
    return () => window.clearTimeout(timer.current);
  }, [defaults.company]);

  useEffect(() => {
    if (!companyId) return;
    startLoadingLinks(async () => {
      setLinks(await loadAppointmentLinksAction(companyId));
    });
  }, [companyId]);

  const startsAtIso = startsLocal ? toIso(startsLocal) : "";
  const startsError = fieldError(state, "startsAt");
  const companyError = fieldError(state, "companyId");
  // La date d'un rendez-vous Cal se change dans Cal : le service refuserait de toute façon.
  const scheduleLocked = defaults.source === "cal";
  const scheduleHint = scheduleLocked ? "Se déplace depuis Cal.diy." : undefined;

  // Envoi sans `action` sur le formulaire : React le réinitialiserait après chaque réponse, et une
  // erreur ferait perdre le client choisi (liste pilotée) et les cases cochées.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const data = new FormData(event.currentTarget);
    startSubmit(() => action(data));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="clientRequestId" value={requestId} />
      <input type="hidden" name="startsAt" value={startsAtIso} />
      <ModalRow>
        <FormAlert state={state.status === "error" ? state : IDLE_ACTION_STATE} />
      </ModalRow>
      <ModalRow>
        <TextField
          state={state}
          name="title"
          label="Titre"
          required
          maxLength={200}
          defaultValue={defaults.title ?? ""}
          data-autofocus
        />
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <Field id="startsAtLocal" label="Date et heure" error={startsError} hint={scheduleHint}>
          <Input
            id="startsAtLocal"
            type="datetime-local"
            required
            readOnly={scheduleLocked}
            value={startsLocal}
            onChange={(event) => setStartsLocal(event.target.value)}
            aria-invalid={startsError ? true : undefined}
          />
        </Field>
        <DurationField
          state={state}
          name="durationMinutes"
          label="Durée"
          readOnly={scheduleLocked}
          defaultMinutes={defaults.durationMinutes ?? 30}
        />
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="kind"
          label="Type"
          placeholder="Suivi, découverte…"
          maxLength={80}
          defaultValue={defaults.kind ?? ""}
        />
        <TextField
          state={state}
          name="channel"
          label="Canal"
          placeholder="Visio, téléphone, sur place…"
          maxLength={80}
          defaultValue={defaults.channel ?? ""}
        />
      </ModalRow>
      <ModalRow>
        <TextField
          state={state}
          name="location"
          label="Lieu ou lien"
          maxLength={300}
          defaultValue={defaults.location ?? ""}
        />
      </ModalRow>
      <ModalRow className="flex flex-col gap-2">
        <SearchField
          value={search}
          onValueChange={(value) => {
            setSearch(value);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
              void searchAppointmentCompaniesAction(value).then((found) =>
                // Le client déjà choisi reste dans la liste, sinon le champ se viderait sans le dire.
                setCompanies((current) => {
                  const selected = current.find((company) => company.id === companyId);
                  return selected && !found.some((company) => company.id === companyId)
                    ? [selected, ...found]
                    : found;
                }),
              );
            }, 250);
          }}
          placeholder="Chercher un client…"
          label="Chercher un client"
          className="sm:w-full"
        />
        <Field id="companyId" label="Client" error={companyError}>
          <Select
            id="companyId"
            name="companyId"
            value={companyId}
            aria-invalid={companyError ? true : undefined}
            onChange={(event) => {
              setCompanyId(event.target.value);
              if (!event.target.value) setLinks(NO_LINKS);
            }}
          >
            <option value="">Choisir un client</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </Select>
        </Field>
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-3">
        <SelectField
          key={`contact-${companyId}-${links.contacts.length}`}
          state={state}
          name="contactId"
          label="Contact"
          disabled={!companyId || loadingLinks}
          defaultValue={defaults.contactId ?? ""}
        >
          <option value="">Aucun</option>
          {links.contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.fullName}
            </option>
          ))}
        </SelectField>
        <SelectField
          key={`project-${companyId}-${links.projects.length}`}
          state={state}
          name="projectId"
          label="Projet"
          disabled={!companyId || loadingLinks}
          defaultValue={defaults.projectId ?? ""}
        >
          <option value="">Aucun</option>
          {links.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.number} · {project.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          key={`opportunity-${companyId}-${links.opportunities.length}`}
          state={state}
          name="opportunityId"
          label="Affaire"
          disabled={!companyId || loadingLinks}
          defaultValue={defaults.opportunityId ?? ""}
        >
          <option value="">Aucune</option>
          {links.opportunities.map((opportunity) => (
            <option key={opportunity.id} value={opportunity.id}>
              {opportunity.name}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      {members.length > 0 ? (
        <ModalRow>
          <fieldset className="flex flex-col">
            <legend className="text-field-label text-text">Participants</legend>
            <div className="grid sm:grid-cols-2">
              {members.map((member) => (
                <Checkbox
                  key={member.id}
                  name="memberIds"
                  value={member.id}
                  label={member.name}
                  defaultChecked={defaults.memberIds?.includes(member.id)}
                />
              ))}
            </div>
            {fieldError(state, "memberIds") ? (
              <p className="text-xs text-danger">{fieldError(state, "memberIds")}</p>
            ) : null}
          </fieldset>
        </ModalRow>
      ) : null}
      <ModalRow className="flex justify-end gap-3">
        <Button onClick={onClose}>Annuler</Button>
        <Button type="submit" variant="accent" loading={submitting}>
          {defaults.id ? "Enregistrer" : "Créer le rendez-vous"}
        </Button>
      </ModalRow>
    </form>
  );
}

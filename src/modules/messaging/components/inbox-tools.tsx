"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { SearchField } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CompactButton } from "@/components/ui/compact-button";
import {
  Field,
  FormAlert,
  Select,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Modal, ModalRow } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { fieldError, IDLE_ACTION_STATE } from "@/lib/action-state";
import {
  archiveConversationAction,
  createConversationAction,
  loadCompanyLinksAction,
  restoreConversationAction,
  searchCompaniesAction,
  updateSuggestionSettingsAction,
} from "../message.actions";
import type { SuggestionSettings } from "../messaging.schema";

const ICON_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-(--dur-fast) hover:bg-surface-raised hover:text-text pointer-coarse:size-11";

interface CompanyOption {
  id: string;
  name: string;
}

interface LinkOptions {
  contacts: { id: string; fullName: string }[];
  projects: { id: string; name: string; number: string }[];
}

const NO_LINKS: LinkOptions = { contacts: [], projects: [] };

/** Bouton « + » de la colonne : ouvre la fenêtre de création, aussi par `?nouvelle=1`. */
export function NewConversationButton({
  initialOpen = false,
  initialCompany = null,
}: {
  initialOpen?: boolean;
  initialCompany?: CompanyOption | null;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Nouvelle conversation"
        title="Nouvelle conversation"
        className={ICON_BUTTON}
      >
        <Icon name="plus" size={18} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle conversation" width={560}>
        <NewConversationForm initialCompany={initialCompany} onCancel={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function NewConversationForm({
  initialCompany,
  onCancel,
}: {
  initialCompany: CompanyOption | null;
  onCancel: () => void;
}) {
  const [state, action, submitting] = useActionState(createConversationAction, IDLE_ACTION_STATE);
  const [, startSubmit] = useTransition();
  const [requestId] = useState(() => globalThis.crypto?.randomUUID?.() ?? "");
  const [search, setSearch] = useState("");
  const [companies, setCompanies] = useState<CompanyOption[]>(
    initialCompany ? [initialCompany] : [],
  );
  const [companyId, setCompanyId] = useState(initialCompany?.id ?? "");
  const [links, setLinks] = useState<LinkOptions>(NO_LINKS);
  const [loadingLinks, startLoadingLinks] = useTransition();
  const timer = useRef<number | undefined>(undefined);

  function runSearch(value: string) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void searchCompaniesAction(value).then((found) =>
        // Le client déjà choisi reste dans la liste, sinon le champ se viderait sans le dire.
        setCompanies((current) => {
          const selected = current.find((company) => company.id === companyId);
          return selected && !found.some((company) => company.id === companyId)
            ? [selected, ...found]
            : found;
        }),
      );
    }, 250);
  }

  useEffect(() => {
    if (!initialCompany) void searchCompaniesAction("").then(setCompanies);
    return () => window.clearTimeout(timer.current);
  }, [initialCompany]);

  useEffect(() => {
    if (!companyId) return;
    startLoadingLinks(async () => {
      setLinks(await loadCompanyLinksAction(companyId));
    });
  }, [companyId]);

  // Envoi sans `action` sur le formulaire : React le réinitialiserait après chaque réponse, et une
  // erreur ferait perdre le client choisi (liste pilotée) et les cases cochées.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const data = new FormData(event.currentTarget);
    startSubmit(() => action(data));
  }

  const companyError = fieldError(state, "companyId");

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="clientRequestId" value={requestId} />
      <ModalRow>
        <FormAlert state={state} />
      </ModalRow>
      <ModalRow className="flex flex-col gap-2">
        <SearchField
          value={search}
          onValueChange={(value) => {
            setSearch(value);
            runSearch(value);
          }}
          placeholder="Chercher un client…"
          label="Chercher un client"
          className="sm:w-full"
        />
        <Field id="companyId" label="Client" error={companyError}>
          <Select
            id="companyId"
            name="companyId"
            required
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
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <SelectField
          state={state}
          name="contactId"
          label="Contact"
          disabled={!companyId || loadingLinks}
          key={`contact-${companyId}`}
        >
          <option value="">Sans contact précis</option>
          {links.contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.fullName}
            </option>
          ))}
        </SelectField>
        <SelectField
          state={state}
          name="projectId"
          label="Projet"
          disabled={!companyId || loadingLinks}
          key={`project-${companyId}`}
        >
          <option value="">Sans projet</option>
          {links.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.number} · {project.name}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      <ModalRow>
        <TextField state={state} name="subject" label="Sujet" maxLength={200} />
      </ModalRow>
      <ModalRow>
        <TextareaField state={state} name="firstMessage" label="Premier message" rows={3} />
      </ModalRow>
      <ModalRow>
        <SelectField
          state={state}
          name="firstDirection"
          label="Ce message est"
          hint="Un message reçu par téléphone ou par e-mail se consigne ici : il compte comme non lu."
          defaultValue="outbound"
        >
          <option value="outbound">Envoyé au client</option>
          <option value="inbound">Reçu du client</option>
          <option value="internal">Une note interne</option>
        </SelectField>
      </ModalRow>
      <ModalRow className="flex justify-end gap-3">
        <Button onClick={onCancel}>Annuler</Button>
        <Button type="submit" variant="accent" loading={submitting}>
          Ouvrir la conversation
        </Button>
      </ModalRow>
    </form>
  );
}

/** Réglages réservés aux associés : l'envoi sans relecture n'existe pas, il n'a donc pas d'option. */
export function SuggestionSettingsButton({ settings }: { settings: SuggestionSettings }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [readProjectContext, setReadProjectContext] = useState(settings.readProjectContext);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateSuggestionSettingsAction({ enabled, readProjectContext });
      if (!result.ok) {
        toast({ message: result.message, tone: "danger" });
        return;
      }
      toast({ message: "Réglages enregistrés." });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Réglages des réponses suggérées"
        title="Réglages des réponses suggérées"
        className={ICON_BUTTON}
      >
        <Icon name="reglages" size={18} />
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Réponses suggérées"
        description="Seul le message traité et, si vous le permettez, un résumé du projet sont transmis à OpenAI. Un associé relit et envoie toujours."
        width={520}
      >
        <ModalRow className="flex flex-col gap-4">
          <Switch
            tone="chatgpt"
            label="Suggérer une réponse"
            description="Sur les nouveaux messages des clients et à la demande."
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <Switch
            tone="chatgpt"
            label="Lire le contexte du projet"
            description="Planning, contenus attendus et prochain rendez-vous. Ni montant ni coordonnées."
            checked={readProjectContext}
            onCheckedChange={setReadProjectContext}
          />
        </ModalRow>
        <ModalRow className="flex justify-end gap-3">
          <Button onClick={() => setOpen(false)}>Annuler</Button>
          <Button variant="accent" loading={pending} onClick={save}>
            Enregistrer
          </Button>
        </ModalRow>
      </Modal>
    </>
  );
}

export function RestoreConversationButton({ conversationId }: { conversationId: string }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <CompactButton
      variant="quiet"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await restoreConversationAction(conversationId);
          toast(
            result.ok
              ? { message: "Conversation rétablie." }
              : { message: result.message, tone: "danger" },
          );
        })
      }
    >
      Rétablir la conversation
    </CompactButton>
  );
}

export function ArchiveConversationButton({ conversationId }: { conversationId: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <CompactButton variant="quiet" onClick={() => setOpen(true)}>
        Archiver la conversation
      </CompactButton>
      <ConfirmDialog
        open={open}
        title="Archiver cette conversation ?"
        description="Les messages restent conservés, mais plus rien ne pourra s'y écrire. Le client ne les verra plus dans son espace."
        confirmLabel="Archiver"
        tone="danger"
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          const result = await archiveConversationAction(conversationId);
          if (result && !result.ok) {
            toast({ message: result.message, tone: "danger" });
            setOpen(false);
          }
        }}
      />
    </>
  );
}

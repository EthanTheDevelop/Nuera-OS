"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CompactButton } from "@/components/ui/compact-button";
import { FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { UploadField } from "@/modules/documents/components/upload-field";
import { openTicketAction, replyTicketAction } from "../portal.actions";
import { usePortalForm } from "./use-portal-form";

const CATEGORIES = [
  { value: "assistance", label: "Besoin d'aide" },
  { value: "question", label: "Une question" },
  { value: "bug", label: "Quelque chose ne marche pas" },
  { value: "incident", label: "Mon site est en panne" },
  { value: "change", label: "Une modification" },
];

/** Absent du dessin (figma-map §8) : ouvrir une demande hors « Modifier mon site ». */
export function NewTicketButton({
  sites,
  variant = "primary",
}: {
  sites: readonly { id: string; name: string }[];
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [state, formAction] = usePortalForm(openTicketAction, (done) => {
    toast({ message: done.message, tone: "success" });
    setOpen(false);
    if (done.ticketId) router.push(`/espace/demandes/${done.ticketId}`);
  });

  return (
    <>
      <CompactButton variant={variant} icon="plus" onClick={() => setOpen(true)}>
        Nouvelle demande
      </CompactButton>
      <Modal open={open} onClose={() => setOpen(false)} width={560} title="Nouvelle demande">
        <form action={formAction} className="flex flex-col gap-4">
          <FormAlert state={state.status === "error" ? state : IDLE_ACTION_STATE} />
          <TextField name="subject" label="Votre demande, en une ligne" state={state} required />
          <TextareaField name="description" label="Quelques détails" state={state} rows={4} />
          <SelectField
            name="category"
            label="De quoi s'agit-il ?"
            state={state}
            defaultValue="assistance"
          >
            {CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </SelectField>
          {sites.length > 0 ? (
            <SelectField name="siteId" label="Site concerné" state={state} defaultValue="">
              <option value="">Aucun en particulier</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          <div className="flex justify-end">
            <SubmitButton>Envoyer ma demande</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function TicketReplyForm({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [state, formAction] = usePortalForm(replyTicketAction, () => {
    form.current?.reset();
    router.refresh();
  });

  return (
    <div className="flex flex-col gap-4">
      <form ref={form} action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="ticketId" value={ticketId} />
        <FormAlert state={state.status === "error" ? state : IDLE_ACTION_STATE} />
        <TextareaField name="body" label="Votre réponse" state={state} rows={3} required />
        <div className="flex justify-end">
          <SubmitButton>Envoyer</SubmitButton>
        </div>
      </form>
      <UploadField
        label="Joindre un fichier"
        target={{ ticketId }}
        onUploaded={() => router.refresh()}
      />
    </div>
  );
}

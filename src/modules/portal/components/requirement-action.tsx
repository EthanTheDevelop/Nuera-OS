"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CompactButton } from "@/components/ui/compact-button";
import { Alert } from "@/components/ui/feedback";
import { FormAlert, TextareaField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { UploadField } from "@/modules/documents/components/upload-field";
import { submitRequirementDocumentAction, submitRequirementTextAction } from "../portal.actions";
import { usePortalForm } from "./use-portal-form";

/**
 * Transmettre un contenu attendu : un fichier, ou quelques lignes. Le fichier part dès qu'il est
 * choisi, puis le contenu passe à « reçu ». Le serveur reste seul juge du client et du projet.
 */
export function RequirementAction({
  requirementId,
  label,
  projectId,
  primary,
}: {
  requirementId: string;
  label: string;
  projectId: string;
  primary: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function finish(message: string) {
    toast({ message, tone: "success" });
    setOpen(false);
    router.refresh();
  }

  const [state, formAction] = usePortalForm(submitRequirementTextAction, (done) =>
    finish(done.message),
  );

  function onUploaded(documentId: string) {
    setUploadError(null);
    startSaving(async () => {
      const result = await submitRequirementDocumentAction({ requirementId, documentId });
      if (result.status === "success") finish(result.message);
      else if (result.status === "error") setUploadError(result.message);
    });
  }

  return (
    <>
      <CompactButton
        variant={primary ? "primary" : "secondary"}
        icon={primary ? "paperclip" : "edit"}
        onClick={() => setOpen(true)}
      >
        {primary ? "Déposer" : "Compléter"}
      </CompactButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={560}
        title={label}
        description="Déposez un fichier, ou écrivez-nous ce qu'il faut savoir."
      >
        <div className="flex flex-col gap-5">
          {uploadError ? <Alert tone="danger">{uploadError}</Alert> : null}
          <UploadField
            label="Votre fichier"
            target={{ projectId, title: label }}
            disabled={saving}
            onUploaded={(document) => onUploaded(document.id)}
          />
          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="requirementId" value={requirementId} />
            <FormAlert state={state.status === "error" ? state : IDLE_ACTION_STATE} />
            <TextareaField name="text" label="Ou par écrit" state={state} rows={4} />
            <div className="flex justify-end">
              <SubmitButton variant="default">Envoyer ce texte</SubmitButton>
            </div>
          </form>
        </div>
      </Modal>
    </>
  );
}

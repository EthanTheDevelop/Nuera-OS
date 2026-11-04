"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { FormAlert, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { ENVIRONMENT_KIND_LABELS, type EnvironmentKind } from "@/lib/domain-enums";
import { saveEnvironmentAction } from "../site.actions";

/** Environnement d'un site : URL et application Coolify. Un seul par type. */
export function EnvironmentFormButton({
  siteId,
  kind,
  url,
  coolifyAppUuid,
  declared,
}: {
  siteId: string;
  kind: EnvironmentKind;
  url: string | null;
  coolifyAppUuid: string | null;
  declared: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CompactButton variant="quiet" onClick={() => setOpen(true)}>
        {declared ? "Modifier" : "Déclarer"}
      </CompactButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Environnement · ${ENVIRONMENT_KIND_LABELS[kind]}`}
        width={560}
      >
        <EnvironmentForm
          siteId={siteId}
          kind={kind}
          url={url}
          coolifyAppUuid={coolifyAppUuid}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

function EnvironmentForm({
  siteId,
  kind,
  url,
  coolifyAppUuid,
  onDone,
}: {
  siteId: string;
  kind: EnvironmentKind;
  url: string | null;
  coolifyAppUuid: string | null;
  onDone: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    saveEnvironmentAction,
    IDLE_ACTION_STATE,
  );
  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="contents">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="kind" value={kind} />
      <ModalRow>
        <FormAlert state={state} />
      </ModalRow>
      <ModalRow className="flex flex-col gap-4">
        <TextField
          state={state}
          name="url"
          label="Adresse"
          type="url"
          placeholder="https://"
          defaultValue={url ?? ""}
          data-autofocus
        />
        <TextField
          state={state}
          name="coolifyAppUuid"
          label="Application Coolify (UUID)"
          hint="Sans application reliée, ni état ni déploiement ne sont disponibles."
          autoCapitalize="off"
          spellCheck={false}
          defaultValue={coolifyAppUuid ?? ""}
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>Enregistrer</SubmitButton>
      </ModalRow>
    </form>
  );
}

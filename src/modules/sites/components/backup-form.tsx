"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { Checkbox, Field, FormAlert, Input, SelectField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { fieldError, IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";
import {
  BACKUP_STATUS_LABELS,
  ENVIRONMENT_KIND_LABELS,
  type EnvironmentKind,
} from "@/lib/domain-enums";
import { recordBackupAction } from "../site.actions";
import { MANUAL_BACKUP_STATUSES } from "../site.schema";

/** Sauvegarde déclarée à la main quand Coolify ne peut pas la relire pour ce site. */
export function BackupFormButton({
  siteId,
  environments,
}: {
  siteId: string;
  environments: readonly { id: string; kind: EnvironmentKind }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CompactButton variant="quiet" onClick={() => setOpen(true)}>
        Enregistrer une sauvegarde
      </CompactButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Enregistrer une sauvegarde"
        description="Déclaration manuelle : elle reste signalée comme telle."
        width={560}
      >
        <BackupForm siteId={siteId} environments={environments} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

const BYTES_PER_MEGABYTE = 1024 * 1024;

function BackupForm({
  siteId,
  environments,
  onDone,
}: {
  siteId: string;
  environments: readonly { id: string; kind: EnvironmentKind }[];
  onDone: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    recordBackupAction,
    IDLE_ACTION_STATE,
  );
  const [takenAt, setTakenAt] = useState("");
  const [sizeMb, setSizeMb] = useState("");

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  // Le navigateur connaît le fuseau de la saisie : le serveur reçoit un instant sans ambiguïté.
  const parsedAt = takenAt ? new Date(takenAt) : null;
  const instant = parsedAt && !Number.isNaN(parsedAt.getTime()) ? parsedAt.toISOString() : "";
  const megabytes = Number(sizeMb.replace(",", "."));
  const sizeBytes =
    sizeMb.trim() !== "" && Number.isFinite(megabytes)
      ? String(Math.round(megabytes * BYTES_PER_MEGABYTE))
      : "";

  return (
    <form action={action} className="contents">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="takenAt" value={instant} />
      <input type="hidden" name="sizeBytes" value={sizeBytes} />
      <ModalRow>
        <FormAlert state={state} />
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <Field id="backup-taken-at" label="Date et heure" error={fieldError(state, "takenAt")}>
          <Input
            id="backup-taken-at"
            type="datetime-local"
            required
            value={takenAt}
            onChange={(event) => setTakenAt(event.target.value)}
            data-autofocus
          />
        </Field>
        <SelectField state={state} name="status" label="Résultat" defaultValue="succeeded">
          {MANUAL_BACKUP_STATUSES.map((status) => (
            <option key={status} value={status}>
              {BACKUP_STATUS_LABELS[status]}
            </option>
          ))}
        </SelectField>
        <SelectField state={state} name="environmentId" label="Environnement" defaultValue="">
          <option value="">Non précisé</option>
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {ENVIRONMENT_KIND_LABELS[environment.kind]}
            </option>
          ))}
        </SelectField>
        <Field id="backup-size" label="Taille (Mo)" error={fieldError(state, "sizeBytes")}>
          <Input
            id="backup-size"
            inputMode="decimal"
            value={sizeMb}
            onChange={(event) => setSizeMb(event.target.value)}
          />
        </Field>
        <Checkbox
          name="offSite"
          label="Copie hors serveur vérifiée"
          description="À cocher seulement si la copie a été constatée."
          className="sm:col-span-2"
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>Enregistrer</SubmitButton>
      </ModalRow>
    </form>
  );
}

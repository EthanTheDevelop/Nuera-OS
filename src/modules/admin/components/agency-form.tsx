"use client";

import { useActionState } from "react";
import { FormAlert, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { InfoCard } from "@/components/ui/info-card";
import { useActionToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import type { AgencyProfile } from "@/modules/platform/settings.service";
import { saveAgencyProfileAction } from "../admin.actions";

export function AgencyForm({ profile, canEdit }: { profile: AgencyProfile; canEdit: boolean }) {
  const [state, action] = useActionState(saveAgencyProfileAction, IDLE_ACTION_STATE);
  useActionToast(state);
  return (
    <InfoCard icon="reglages" title="Fiche de l'agence" className="max-w-[688px]">
      <form action={action} className="flex flex-col gap-4">
        <FormAlert state={state} />
        <TextField
          name="name"
          label="Nom"
          state={state}
          defaultValue={profile.name}
          required
          readOnly={!canEdit}
        />
        <TextField
          name="replyTo"
          type="email"
          label="Adresse de réponse des e-mails"
          hint="Les réponses aux e-mails envoyés par Nuera OS arrivent ici."
          state={state}
          defaultValue={profile.replyTo ?? ""}
          readOnly={!canEdit}
        />
        <TextField
          name="phone"
          label="Téléphone"
          state={state}
          defaultValue={profile.phone ?? ""}
          readOnly={!canEdit}
        />
        <TextField
          name="address"
          label="Adresse"
          state={state}
          defaultValue={profile.address ?? ""}
          readOnly={!canEdit}
        />
        <TextField
          name="siren"
          label="SIREN"
          state={state}
          defaultValue={profile.siren ?? ""}
          readOnly={!canEdit}
        />
        {canEdit ? (
          <div className="flex justify-end">
            <SubmitButton>Enregistrer</SubmitButton>
          </div>
        ) : null}
      </form>
    </InfoCard>
  );
}

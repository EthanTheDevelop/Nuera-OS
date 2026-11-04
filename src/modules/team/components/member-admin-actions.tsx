"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert, SelectField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast, useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { archiveMemberAction, linkUserAction, restoreMemberAction } from "../team.actions";
import type { LinkableUser } from "../team.service";

/** Archiver ou restaurer un membre : confirmation, et le refus du service s'affiche tel quel. */
export function ArchiveMemberButton({
  memberId,
  archived,
}: {
  memberId: string;
  archived: boolean;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Button onClick={() => setConfirming(true)}>{archived ? "Restaurer" : "Archiver"}</Button>
      <ConfirmDialog
        open={confirming}
        title={archived ? "Restaurer ce membre ?" : "Archiver ce membre ?"}
        description={
          archived
            ? "La fiche redevient active et compte à nouveau dans la capacité."
            : "La fiche sort de la capacité et des listes de choix. Son temps et ses missions restent."
        }
        confirmLabel={archived ? "Restaurer" : "Archiver"}
        tone={archived ? "default" : "danger"}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          const result = archived
            ? await restoreMemberAction(memberId)
            : await archiveMemberAction(memberId);
          setConfirming(false);
          if (result.status === "error") toast({ message: result.message, tone: "danger" });
          if (result.status === "success") toast({ message: result.message });
        }}
      />
    </>
  );
}

function LinkForm({
  memberId,
  users,
  currentUserId,
  onDone,
}: {
  memberId: string;
  users: readonly LinkableUser[];
  currentUserId: string | null;
  onDone: () => void;
}) {
  const [state, action] = useActionState(linkUserAction, IDLE_ACTION_STATE);
  useActionToast(state);

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="contents">
      <input type="hidden" name="memberId" value={memberId} />
      <FormAlert state={state} />
      <ModalRow>
        <SelectField
          state={state}
          name="userId"
          label="Compte"
          hint="Une fiche de prestataire se relie à un compte de rôle Prestataire."
          defaultValue={currentUserId ?? ""}
          data-autofocus
        >
          <option value="">Aucun compte</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} · {user.email}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>Enregistrer</SubmitButton>
      </ModalRow>
    </form>
  );
}

/** Relier une fiche à un compte : réservé aux associés (`users:manage`), vérifié par le service. */
export function LinkUserButton({
  memberId,
  users,
  currentUserId,
}: {
  memberId: string;
  users: readonly LinkableUser[];
  currentUserId: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CompactButton variant="secondary" onClick={() => setOpen(true)}>
        {currentUserId ? "Changer le compte" : "Relier un compte"}
      </CompactButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Compte relié" width={480}>
        <LinkForm
          memberId={memberId}
          users={users}
          currentUserId={currentUserId}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

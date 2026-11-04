"use client";

import { useCallback, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { FormAlert, SelectField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Icon } from "@/components/ui/icon";
import { Modal, ModalRow } from "@/components/ui/modal";
import { Tile } from "@/components/ui/tile";
import type { MemberOption } from "@/modules/team/team.lookup";
import { addProjectMemberAction, removeProjectMemberAction } from "../project.actions";
import type { ProjectDetail } from "../project.service";
import { useCommand, useWindowForm } from "./use-project-command";

function AddMemberForm({
  projectId,
  members,
  onDone,
}: {
  projectId: string;
  members: readonly MemberOption[];
  onDone: () => void;
}) {
  const { state, formAction } = useWindowForm(addProjectMemberAction, onDone);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormAlert state={state} />
      <input type="hidden" name="projectId" value={projectId} />
      <SelectField state={state} name="memberId" label="Personne" required defaultValue="">
        <option value="" disabled>
          Choisir…
        </option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.fullName}
          </option>
        ))}
      </SelectField>
      <TextField state={state} name="role" label="Rôle sur le projet" />
      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>Ajouter</SubmitButton>
      </div>
    </form>
  );
}

/** Intervenants du projet : c'est aussi le périmètre d'un prestataire. */
export function TeamCard({
  projectId,
  team,
  members,
  editable,
}: {
  projectId: string;
  team: ProjectDetail["team"];
  members: readonly MemberOption[];
  editable: boolean;
}) {
  const { run, pending } = useCommand();
  const [adding, setAdding] = useState(false);
  const close = useCallback(() => setAdding(false), []);
  const onProject = new Set(team.map((member) => member.memberId));
  const available = members.filter((member) => !onProject.has(member.id));

  return (
    <Tile
      icon="equipe"
      title="Intervenants"
      className="gap-3 rounded-lg p-6"
      aside={
        editable && available.length > 0 ? (
          <CompactButton variant="quiet" icon="plus" onClick={() => setAdding(true)}>
            Ajouter
          </CompactButton>
        ) : undefined
      }
    >
      {team.length === 0 ? (
        <p className="text-sm text-muted">Aucun intervenant pour l’instant.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {team.map((member) => (
            <li key={member.memberId} className="flex items-center gap-3 text-sm text-text">
              <Avatar name={member.fullName} size={28} />
              <span className="min-w-0 flex-1 truncate">
                {member.fullName}
                {member.role ? <span className="text-muted"> · {member.role}</span> : null}
              </span>
              {editable ? (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Retirer ${member.fullName} du projet`}
                  onClick={() => run(() => removeProjectMemberAction(projectId, member.memberId))}
                  className="hit-44 shrink-0 rounded-sm text-muted hover:text-danger"
                >
                  <Icon name="minus" size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Modal open={adding} onClose={close} width={480} title="Ajouter un intervenant">
        <ModalRow>
          <AddMemberForm projectId={projectId} members={available} onDone={close} />
        </ModalRow>
      </Modal>
    </Tile>
  );
}

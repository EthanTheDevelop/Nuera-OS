"use client";

import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { FormAlert, TextareaField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { Tile } from "@/components/ui/tile";
import { formatDateShort } from "@/lib/format";
import { raiseBlockerAction, resolveBlockerAction, updateBlockerAction } from "../project.actions";
import type { ProjectDetail } from "../project.service";
import { useCommand, useWindowForm } from "./use-project-command";

export type BlockerView = ProjectDetail["blockers"][number] & {
  /** `2 jours`, calculé côté serveur. */
  age: string;
};

function BlockerForm({
  projectId,
  blocker,
  onDone,
}: {
  projectId: string;
  blocker?: BlockerView;
  onDone: () => void;
}) {
  const { state, formAction } = useWindowForm(
    blocker ? updateBlockerAction : raiseBlockerAction,
    onDone,
  );
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        {blocker ? (
          <input type="hidden" name="blockerId" value={blocker.id} />
        ) : (
          <input type="hidden" name="projectId" value={projectId} />
        )}
        <TextField
          state={state}
          name="title"
          label="Ce qui bloque"
          required
          defaultValue={blocker?.title}
        />
        <TextareaField
          state={state}
          name="consequence"
          label="Conséquence"
          rows={2}
          defaultValue={blocker?.consequence ?? ""}
        />
        <TextareaField
          state={state}
          name="decision"
          label="Décision"
          rows={2}
          defaultValue={blocker?.decision ?? ""}
        />
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>{blocker ? "Enregistrer" : "Signaler le blocage"}</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

/** Blocage (Figma 100:5133) : pas de retard silencieux. Ce qui est levé reste au journal de la carte. */
export function BlockerCard({
  projectId,
  blockers,
  editable,
}: {
  projectId: string;
  blockers: readonly BlockerView[];
  editable: boolean;
}) {
  const { run, pending } = useCommand();
  const [editing, setEditing] = useState<string | null>(null);
  const close = useCallback(() => setEditing(null), []);
  const open = blockers.filter((blocker) => !blocker.resolvedAt);
  const resolved = blockers.filter((blocker) => blocker.resolvedAt);
  const current = blockers.find((blocker) => blocker.id === editing);

  return (
    <Tile
      icon="alert"
      title={open.length > 1 ? `Blocages · ${open.length}` : "Blocage"}
      className="gap-3 rounded-lg p-6"
      aside={open[0] ? <Badge tone="warn">{open[0].age}</Badge> : undefined}
    >
      {open.length === 0 ? <p className="text-sm text-muted">Aucun blocage en cours.</p> : null}
      {open.map((blocker) => (
        <article key={blocker.id} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">{blocker.title}</h3>
          {blocker.consequence || blocker.decision ? (
            <p className="text-sm text-muted">
              {blocker.consequence ? `Conséquence : ${blocker.consequence}` : ""}
              {blocker.consequence && blocker.decision ? " " : ""}
              {blocker.decision ? `Décision : ${blocker.decision}` : ""}
            </p>
          ) : null}
          {editable ? (
            <div className="flex flex-wrap gap-4">
              <CompactButton variant="quiet" onClick={() => setEditing(blocker.id)}>
                Modifier
              </CompactButton>
              <CompactButton
                variant="quiet"
                loading={pending}
                onClick={() => run(() => resolveBlockerAction(blocker.id))}
              >
                Lever le blocage
              </CompactButton>
            </div>
          ) : null}
        </article>
      ))}
      {editable ? (
        <div>
          <CompactButton variant="secondary" icon="plus" onClick={() => setEditing("new")}>
            Signaler un blocage
          </CompactButton>
        </div>
      ) : null}
      {resolved.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-border pt-3 text-xs text-muted">
          {resolved.slice(0, 5).map((blocker) => (
            <li key={blocker.id}>
              {blocker.title} · levé le {formatDateShort(blocker.resolvedAt)}
            </li>
          ))}
        </ul>
      ) : null}
      <Modal
        open={editing !== null}
        onClose={close}
        width={560}
        title={current ? "Modifier le blocage" : "Signaler un blocage"}
      >
        <BlockerForm key={editing ?? ""} projectId={projectId} blocker={current} onDone={close} />
      </Modal>
    </Tile>
  );
}

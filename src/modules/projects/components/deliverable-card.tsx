"use client";

import { useCallback, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { Checkbox, Field, FormAlert, SelectField, Textarea, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { Tile } from "@/components/ui/tile";
import { DELIVERABLE_STATUS_LABELS, type DeliverableStatus } from "@/lib/domain-enums";
import { formatDateShort } from "@/lib/format";
import {
  archiveDeliverableAction,
  createDeliverableAction,
  reviewDeliverableAction,
  startDeliverableVersionAction,
  submitDeliverableAction,
  updateDeliverableAction,
} from "../project.actions";
import type { DeliverableView } from "../project.service";
import { ArchiveItemButton } from "./archive-item-button";
import { useCommand, useWindowForm } from "./use-project-command";

interface Option {
  id: string;
  name: string;
}

/** Badge de la carte (Figma 100:5147) : `validée 24 oct.` ou `en attente`. */
function statusOf(deliverable: DeliverableView): { label: string; tone: BadgeTone } {
  switch (deliverable.status as DeliverableStatus) {
    case "validated":
      return {
        label: deliverable.lastValidatedAt
          ? `validée ${formatDateShort(deliverable.lastValidatedAt)}`
          : "validée",
        tone: "success",
      };
    case "to_validate":
      return { label: "en attente", tone: "warn" };
    case "changes_requested":
      return { label: "à revoir", tone: "warn" };
    default:
      return { label: "brouillon", tone: "neutral" };
  }
}

function DeliverableForm({
  projectId,
  deliverable,
  phases,
  documents,
  onDone,
}: {
  projectId: string;
  deliverable?: DeliverableView;
  phases: readonly Option[];
  documents: readonly Option[];
  onDone: () => void;
}) {
  const { state, formAction } = useWindowForm(
    deliverable ? updateDeliverableAction : createDeliverableAction,
    onDone,
  );
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormAlert state={state} />
      {deliverable ? (
        <input type="hidden" name="deliverableId" value={deliverable.id} />
      ) : (
        <input type="hidden" name="projectId" value={projectId} />
      )}
      <TextField
        state={state}
        name="title"
        label="Titre"
        required
        defaultValue={deliverable?.title}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          state={state}
          name="phaseId"
          label="Jalon"
          defaultValue={deliverable?.phaseId ?? ""}
        >
          <option value="">Sans jalon</option>
          {phases.map((phase) => (
            <option key={phase.id} value={phase.id}>
              {phase.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          state={state}
          name="documentId"
          label="Document"
          hint={documents.length === 0 ? "Aucun document sur ce projet pour l’instant." : undefined}
          defaultValue={deliverable?.documentId ?? ""}
        >
          <option value="">Aucun</option>
          {documents.map((document) => (
            <option key={document.id} value={document.id}>
              {document.name}
            </option>
          ))}
        </SelectField>
        <TextField
          state={state}
          name="feedbackRoundsIncluded"
          label="Tours de retours inclus"
          type="number"
          min={0}
          max={50}
          hint="Au-delà, une demande de changement s’ouvre. 0 : sans limite."
          defaultValue={String(deliverable?.feedbackRoundsIncluded ?? 2)}
        />
      </div>
      <Checkbox
        name="requiresClientValidation"
        label="Validation du client requise"
        defaultChecked={deliverable?.requiresClientValidation ?? true}
      />
      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>{deliverable ? "Enregistrer" : "Ajouter le livrable"}</SubmitButton>
      </div>
    </form>
  );
}

function DeliverableDetail({
  projectId,
  deliverable,
  phases,
  documents,
  editable,
  onDone,
}: {
  projectId: string;
  deliverable: DeliverableView;
  phases: readonly Option[];
  documents: readonly Option[];
  editable: boolean;
  onDone: () => void;
}) {
  const { run, pending } = useCommand();
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const status = deliverable.status as DeliverableStatus;
  const rounds =
    deliverable.feedbackRoundsIncluded > 0
      ? `${deliverable.feedbackRoundsUsed} / ${deliverable.feedbackRoundsIncluded} tours de retours`
      : `${deliverable.feedbackRoundsUsed} tour${deliverable.feedbackRoundsUsed > 1 ? "s" : ""} de retours`;

  if (editing) {
    return (
      <ModalRow>
        <DeliverableForm
          projectId={projectId}
          deliverable={deliverable}
          phases={phases}
          documents={documents}
          onDone={() => setEditing(false)}
        />
      </ModalRow>
    );
  }

  return (
    <>
      <ModalRow>
        <p className="text-sm text-muted">
          Version {deliverable.version} · {DELIVERABLE_STATUS_LABELS[status]} · {rounds}
          {deliverable.requiresClientValidation ? "" : " · interne"}
        </p>
        {deliverable.documentId ? (
          <a
            href={`/api/documents/${deliverable.documentId}/download`}
            className="mt-2 inline-block text-sm text-accent hover:underline hover:underline-offset-4"
          >
            {deliverable.documentTitle ?? "Ouvrir le document"}
          </a>
        ) : null}
      </ModalRow>

      {editable ? (
        <ModalRow className="flex flex-col gap-3">
          {status === "draft" || status === "changes_requested" ? (
            <p className="text-sm text-muted">
              {status === "changes_requested"
                ? `Soumettre crée la version ${deliverable.version + 1}.`
                : "Une fois soumis, le livrable attend sa validation dans l’espace client."}
            </p>
          ) : null}
          {status === "to_validate" ? (
            <Field id="review-comment" label="Retours ou décision du client">
              <Textarea
                id="review-comment"
                rows={3}
                maxLength={4000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {status === "draft" || status === "changes_requested" ? (
              <CompactButton
                loading={pending}
                onClick={() => run(() => submitDeliverableAction(deliverable.id), onDone)}
              >
                Soumettre à validation
              </CompactButton>
            ) : null}
            {status === "to_validate" ? (
              <>
                <CompactButton
                  loading={pending}
                  onClick={() =>
                    run(() => reviewDeliverableAction(deliverable.id, "validated", comment), onDone)
                  }
                >
                  Enregistrer la validation
                </CompactButton>
                <CompactButton
                  variant="secondary"
                  loading={pending}
                  onClick={() =>
                    run(
                      () => reviewDeliverableAction(deliverable.id, "changes_requested", comment),
                      onDone,
                    )
                  }
                >
                  Enregistrer les retours
                </CompactButton>
              </>
            ) : null}
            {status === "validated" ? (
              <CompactButton
                variant="secondary"
                loading={pending}
                onClick={() => run(() => startDeliverableVersionAction(deliverable.id), onDone)}
              >
                Repartir sur une nouvelle version
              </CompactButton>
            ) : null}
            <CompactButton variant="quiet" onClick={() => setEditing(true)}>
              Modifier
            </CompactButton>
            <ArchiveItemButton
              subject={deliverable.title}
              description="Le livrable sort du projet. Refusé s'il a été soumis ou relu par le client. L'opération est tracée dans le journal."
              action={() => archiveDeliverableAction(deliverable.id)}
              onDone={onDone}
            />
          </div>
        </ModalRow>
      ) : null}

      <ModalRow className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-text">Décisions</h3>
        {deliverable.reviews.length === 0 ? (
          <p className="text-sm text-muted">Aucune décision pour l’instant.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {deliverable.reviews.map((review) => (
              <li key={review.id} className="text-sm text-text">
                <span className="text-muted">
                  V{review.version} · {formatDateShort(review.at)} ·{" "}
                </span>
                {review.decision === "validated" ? "Validée" : "Retours demandés"}
                {review.comment ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-muted">{review.comment}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </ModalRow>
    </>
  );
}

/** Validation client (Figma 100:5147) : livrables, versions et tours de retours conservés. */
export function DeliverableCard({
  projectId,
  deliverables,
  phases,
  documents,
  editable,
}: {
  projectId: string;
  deliverables: readonly DeliverableView[];
  phases: readonly Option[];
  documents: readonly Option[];
  editable: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const close = useCallback(() => setSelected(null), []);
  const current = deliverables.find((deliverable) => deliverable.id === selected);

  return (
    <Tile
      icon="edit"
      title="Validation client"
      className="gap-3 rounded-lg p-6"
      aside={
        editable ? (
          <CompactButton variant="quiet" icon="plus" onClick={() => setSelected("new")}>
            Ajouter
          </CompactButton>
        ) : undefined
      }
    >
      {deliverables.length === 0 ? (
        <p className="text-sm text-muted">Aucun livrable pour l’instant.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {deliverables.map((deliverable) => {
            const { label, tone } = statusOf(deliverable);
            return (
              <li key={deliverable.id}>
                <button
                  type="button"
                  onClick={() => setSelected(deliverable.id)}
                  className="flex min-h-9 w-full items-center justify-between gap-3 rounded-sm text-left text-sm text-text hover:bg-surface-raised/60 focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <span className="min-w-0 truncate">{deliverable.title}</span>
                  <Badge tone={tone} className="shrink-0">
                    {label}
                  </Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Modal
        open={selected !== null}
        onClose={close}
        width={560}
        title={current ? current.title : "Nouveau livrable"}
      >
        {current ? (
          <DeliverableDetail
            key={current.id}
            projectId={projectId}
            deliverable={current}
            phases={phases}
            documents={documents}
            editable={editable}
            onDone={close}
          />
        ) : (
          <ModalRow>
            <DeliverableForm
              projectId={projectId}
              phases={phases}
              documents={documents}
              onDone={close}
            />
          </ModalRow>
        )}
      </Modal>
    </Tile>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { FormAlert, TextareaField, TextField } from "@/components/ui/form";
import { DurationField, MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { Tile } from "@/components/ui/tile";
import { CHANGE_REQUEST_STATUS_LABELS, type ChangeRequestStatus } from "@/lib/domain-enums";
import { formatDays } from "@/lib/format";
import { formatCentsHT } from "@/lib/money";
import {
  acceptChangeRequestAction,
  convertChangeRequestAction,
  createChangeRequestAction,
  refuseChangeRequestAction,
  updateChangeRequestAction,
} from "../project.actions";
import type { ProjectDetail } from "../project.service";
import { useCommand, useWindowForm } from "./use-project-command";

type ChangeRequest = ProjectDetail["changeRequests"][number];

const TONES: Record<ChangeRequestStatus, BadgeTone> = {
  open: "warn",
  accepted: "accent",
  refused: "neutral",
  converted: "success",
};

function estimate(request: ChangeRequest): string {
  const parts: string[] = [];
  if (request.amountCents !== null) parts.push(formatCentsHT(request.amountCents));
  if (request.estimatedMinutes !== null) parts.push(formatDays(request.estimatedMinutes));
  return parts.join(" · ");
}

function ChangeRequestForm({
  projectId,
  request,
  onDone,
}: {
  projectId: string;
  request?: ChangeRequest;
  onDone: () => void;
}) {
  const { state, formAction } = useWindowForm(
    request ? updateChangeRequestAction : createChangeRequestAction,
    onDone,
  );
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormAlert state={state} />
      {request ? (
        <input type="hidden" name="changeRequestId" value={request.id} />
      ) : (
        <input type="hidden" name="projectId" value={projectId} />
      )}
      <TextField
        state={state}
        name="title"
        label="Demande"
        required
        defaultValue={request?.title}
      />
      <TextareaField
        state={state}
        name="description"
        label="Description"
        rows={3}
        defaultValue={request?.description ?? ""}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <DurationField
          state={state}
          name="estimatedMinutes"
          label="Temps estimé"
          defaultMinutes={request?.estimatedMinutes ?? null}
        />
        <MoneyField
          state={state}
          name="amountCents"
          label="Montant HT"
          defaultCents={request?.amountCents ?? null}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>{request ? "Enregistrer" : "Créer la demande"}</SubmitButton>
      </div>
    </form>
  );
}

function RequestDetail({
  request,
  projectId,
  editable,
  canConvert,
  onDone,
}: {
  request: ChangeRequest;
  projectId: string;
  editable: boolean;
  canConvert: boolean;
  onDone: () => void;
}) {
  const { run, pending } = useCommand();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <ModalRow>
        <ChangeRequestForm
          projectId={projectId}
          request={request}
          onDone={() => setEditing(false)}
        />
      </ModalRow>
    );
  }
  const summary = estimate(request);
  return (
    <>
      <ModalRow className="flex flex-col gap-2">
        <p className="text-sm text-muted">
          {CHANGE_REQUEST_STATUS_LABELS[request.status]}
          {summary ? ` · ${summary}` : ""}
        </p>
        {request.description ? (
          <p className="text-sm whitespace-pre-wrap text-text">{request.description}</p>
        ) : null}
        {request.quoteId ? (
          <Link
            href={`/devis/${request.quoteId}`}
            className="text-sm text-accent hover:underline hover:underline-offset-4"
          >
            Voir le devis
          </Link>
        ) : null}
      </ModalRow>
      {editable && (request.status === "open" || request.status === "accepted") ? (
        <ModalRow className="flex flex-wrap gap-2">
          {request.status === "open" ? (
            <CompactButton
              loading={pending}
              onClick={() => run(() => acceptChangeRequestAction(request.id), onDone)}
            >
              Accepter les travaux
            </CompactButton>
          ) : null}
          {canConvert ? (
            <CompactButton
              variant="secondary"
              loading={pending}
              onClick={() => run(() => convertChangeRequestAction(request.id))}
            >
              Transformer en devis
            </CompactButton>
          ) : null}
          {request.status === "open" ? (
            <>
              <CompactButton
                variant="secondary"
                loading={pending}
                onClick={() => run(() => refuseChangeRequestAction(request.id), onDone)}
              >
                Refuser
              </CompactButton>
              <CompactButton variant="quiet" onClick={() => setEditing(true)}>
                Modifier
              </CompactButton>
            </>
          ) : null}
        </ModalRow>
      ) : null}
    </>
  );
}

/** Demandes de changement et hors périmètre. Rien dans Figma : même langage que les cartes voisines. */
export function ChangeRequestCard({
  projectId,
  requests,
  editable,
  canConvert,
}: {
  projectId: string;
  requests: readonly ChangeRequest[];
  editable: boolean;
  canConvert: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const close = useCallback(() => setSelected(null), []);
  const current = requests.find((request) => request.id === selected);

  return (
    <Tile
      icon="contrat"
      title="Demandes de changement"
      className="gap-3 rounded-lg p-6"
      aside={
        editable ? (
          <CompactButton variant="quiet" icon="plus" onClick={() => setSelected("new")}>
            Ajouter
          </CompactButton>
        ) : undefined
      }
    >
      {requests.length === 0 ? (
        <p className="text-sm text-muted">Aucune demande hors périmètre pour l’instant.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {requests.map((request) => {
            const summary = estimate(request);
            return (
              <li key={request.id}>
                <button
                  type="button"
                  onClick={() => setSelected(request.id)}
                  className="flex min-h-10 w-full items-center justify-between gap-3 rounded-sm py-1 text-left text-sm text-text hover:bg-surface-raised/60 focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{request.title}</span>
                    {summary ? (
                      <span className="block truncate text-xs text-muted">{summary}</span>
                    ) : null}
                  </span>
                  <Badge tone={TONES[request.status]} className="shrink-0">
                    {CHANGE_REQUEST_STATUS_LABELS[request.status]}
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
        title={current ? current.title : "Nouvelle demande de changement"}
      >
        {current ? (
          <RequestDetail
            key={current.id}
            request={current}
            projectId={projectId}
            editable={editable}
            canConvert={canConvert}
            onDone={close}
          />
        ) : (
          <ModalRow>
            <ChangeRequestForm projectId={projectId} onDone={close} />
          </ModalRow>
        )}
      </Modal>
    </Tile>
  );
}

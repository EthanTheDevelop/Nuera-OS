"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { DateField, FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { DurationField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { formatDateShort, formatMinutes } from "@/lib/format";
import {
  completeInterventionAction,
  createInterventionAction,
  updateInterventionAction,
} from "../contract.actions";
import type { InterventionRow, SiteOption } from "../contract.types";
import { useModalForm } from "./use-modal-form";

interface MemberChoice {
  id: string;
  fullName: string;
}

function LinkFields({
  state,
  sites,
  members,
  siteId,
  memberId,
}: {
  state: Parameters<typeof SelectField>[0]["state"];
  sites: readonly SiteOption[];
  members: readonly MemberChoice[];
  siteId?: string | null;
  memberId?: string | null;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField state={state} name="siteId" label="Site" defaultValue={siteId ?? ""}>
        <option value="">Aucun site précis</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.primaryDomain ?? site.name}
          </option>
        ))}
      </SelectField>
      <SelectField state={state} name="memberId" label="Intervenant" defaultValue={memberId ?? ""}>
        <option value="">À attribuer</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.fullName}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

function CreateForm({
  contractId,
  mode,
  today,
  sites,
  members,
  onDone,
}: {
  contractId: string;
  mode: "plan" | "log";
  today: string;
  sites: readonly SiteOption[];
  members: readonly MemberChoice[];
  onDone: () => void;
}) {
  const { state, formAction } = useModalForm(
    createInterventionAction.bind(null, contractId),
    onDone,
  );
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        <TextField state={state} name="title" label="Intervention" required data-autofocus />
        <LinkFields state={state} sites={sites} members={members} />
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === "plan" ? (
            <DateField state={state} name="plannedOn" label="Date prévue" required />
          ) : (
            <DateField
              state={state}
              name="doneOn"
              label="Réalisée le"
              defaultValue={today}
              max={today}
              required
            />
          )}
          <DurationField
            state={state}
            name="minutes"
            label={mode === "plan" ? "Temps estimé" : "Temps passé"}
            hint={mode === "log" ? "Décompté du forfait de la période." : undefined}
          />
        </div>
        {mode === "log" ? (
          <TextareaField state={state} name="result" label="Résultat" rows={3} />
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>{mode === "plan" ? "Planifier" : "Consigner"}</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

function EditForm({
  contractId,
  intervention,
  sites,
  members,
  onDone,
}: {
  contractId: string;
  intervention: InterventionRow;
  sites: readonly SiteOption[];
  members: readonly MemberChoice[];
  onDone: () => void;
}) {
  const { state, formAction } = useModalForm(
    updateInterventionAction.bind(null, contractId, intervention.id),
    onDone,
  );
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        <TextField
          state={state}
          name="title"
          label="Intervention"
          defaultValue={intervention.title}
          required
        />
        <LinkFields
          state={state}
          sites={sites}
          members={members}
          siteId={intervention.siteId}
          memberId={intervention.memberId}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField
            state={state}
            name="plannedOn"
            label="Date prévue"
            defaultValue={intervention.plannedOn ?? ""}
          />
          <DurationField
            state={state}
            name="minutes"
            label="Temps estimé"
            defaultMinutes={intervention.minutes}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>Enregistrer</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

function CompleteForm({
  contractId,
  intervention,
  today,
  onDone,
}: {
  contractId: string;
  intervention: InterventionRow;
  today: string;
  onDone: () => void;
}) {
  const { state, formAction } = useModalForm(
    completeInterventionAction.bind(null, contractId, intervention.id),
    onDone,
  );
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField
            state={state}
            name="doneOn"
            label="Réalisée le"
            defaultValue={today}
            max={today}
            required
          />
          <DurationField
            state={state}
            name="minutes"
            label="Temps passé"
            hint="Décompté du forfait de la période."
            defaultMinutes={intervention.minutes}
            required
            data-autofocus
          />
        </div>
        <TextareaField state={state} name="result" label="Résultat" rows={3} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>Marquer réalisée</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

function detail(row: InterventionRow): string {
  return [
    row.siteName,
    row.memberName,
    row.minutes !== null ? formatMinutes(row.minutes) : null,
    row.doneOn || row.cancelled ? row.result : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Row({
  row,
  canEdit,
  onEdit,
  onComplete,
}: {
  row: InterventionRow;
  canEdit: boolean;
  onEdit: () => void;
  onComplete: () => void;
}) {
  const open = !row.doneOn && !row.cancelled;
  const day = row.doneOn ?? row.plannedOn;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
      <time
        dateTime={day ?? undefined}
        className="w-16 shrink-0 pt-px font-mono text-amount-compact text-muted"
      >
        {day ? formatDateShort(day) : "—"}
      </time>
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-sm font-medium text-text">{row.title}</p>
        {detail(row) || row.ticketId ? (
          <p className="mt-0.5 text-xs text-muted">
            {detail(row)}
            {row.ticketId ? (
              <>
                {detail(row) ? " · " : ""}
                <Link
                  href={`/support/${row.ticketId}`}
                  className="text-accent hover:underline hover:underline-offset-4"
                >
                  {row.ticketNumber}
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      <span className="flex shrink-0 flex-wrap items-center gap-2">
        {row.doneOn ? (
          <Badge tone="success">Réalisée</Badge>
        ) : row.cancelled ? (
          <Badge>Annulée</Badge>
        ) : (
          <Badge tone="accent">Prévue</Badge>
        )}
        {open && canEdit ? (
          <>
            <CompactButton
              variant="quiet"
              aria-label={`Modifier l'intervention ${row.title}`}
              onClick={onEdit}
            >
              Modifier
            </CompactButton>
            <CompactButton
              variant="secondary"
              aria-label={`Réaliser l'intervention ${row.title}`}
              onClick={onComplete}
            >
              Réaliser
            </CompactButton>
          </>
        ) : null}
      </span>
    </li>
  );
}

type Dialog =
  { kind: "plan" | "log" } | { kind: "edit" | "complete"; intervention: InterventionRow } | null;

/** Journal de maintenance de la fiche : prévu d'abord, puis réalisé. */
export function InterventionJournal({
  contractId,
  rows,
  today,
  sites,
  members,
  canEdit,
  canPlan,
  canLog,
}: {
  contractId: string;
  rows: readonly InterventionRow[];
  today: string;
  sites: readonly SiteOption[];
  members: readonly MemberChoice[];
  canEdit: boolean;
  /** Le journal d'un contrat terminé est clos. */
  canPlan: boolean;
  /** Un contrat non démarré ne peut que prévoir. */
  canLog: boolean;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = useCallback(() => setDialog(null), []);
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Aucune intervention prévue ni réalisée.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              canEdit={canEdit && canPlan}
              onEdit={() => setDialog({ kind: "edit", intervention: row })}
              onComplete={() => setDialog({ kind: "complete", intervention: row })}
            />
          ))}
        </ul>
      )}
      {canEdit && canPlan ? (
        <div className="flex flex-wrap gap-2">
          <CompactButton
            variant="secondary"
            icon="calendar"
            onClick={() => setDialog({ kind: "plan" })}
          >
            Planifier
          </CompactButton>
          {canLog ? (
            <CompactButton
              variant="secondary"
              icon="check"
              onClick={() => setDialog({ kind: "log" })}
            >
              Consigner une intervention réalisée
            </CompactButton>
          ) : null}
        </div>
      ) : null}
      <Modal
        open={dialog?.kind === "plan" || dialog?.kind === "log"}
        onClose={close}
        title={dialog?.kind === "log" ? "Consigner une intervention" : "Planifier une intervention"}
        icon="calendar"
        width={560}
      >
        {dialog?.kind === "plan" || dialog?.kind === "log" ? (
          <CreateForm
            contractId={contractId}
            mode={dialog.kind}
            today={today}
            sites={sites}
            members={members}
            onDone={close}
          />
        ) : null}
      </Modal>
      <Modal
        open={dialog?.kind === "edit"}
        onClose={close}
        title="Modifier l'intervention"
        icon="edit"
        width={560}
      >
        {dialog?.kind === "edit" ? (
          <EditForm
            contractId={contractId}
            intervention={dialog.intervention}
            sites={sites}
            members={members}
            onDone={close}
          />
        ) : null}
      </Modal>
      <Modal
        open={dialog?.kind === "complete"}
        onClose={close}
        title={dialog?.kind === "complete" ? dialog.intervention.title : ""}
        icon="check"
        width={560}
      >
        {dialog?.kind === "complete" ? (
          <CompleteForm
            contractId={contractId}
            intervention={dialog.intervention}
            today={today}
            onDone={close}
          />
        ) : null}
      </Modal>
    </div>
  );
}

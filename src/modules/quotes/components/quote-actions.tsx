"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { ConnectionRequired } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateField, FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast, useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { formatCents } from "@/lib/money";
import {
  acceptManuallyAction,
  archiveQuoteAction,
  checkSignatureAction,
  createAmendmentAction,
  expireQuoteAction,
  markSentManuallyAction,
  negotiationAction,
  refuseQuoteAction,
  sendForSignatureAction,
  updateReferencesAction,
} from "../quote.actions";
import type { QuoteActions } from "../quote.rules";

export interface SignerOption {
  id: string;
  fullName: string;
  email: string | null;
}

export interface QuoteActionsProps {
  quoteId: string;
  number: string;
  title: string;
  actions: QuoteActions;
  canUpdate: boolean;
  canSend: boolean;
  canCreate: boolean;
  signatureConfigured: boolean;
  signers: readonly SignerOption[];
  defaultSignerId: string | null;
  indyReference: string | null;
  officialDocumentUrl: string | null;
  today: string;
  /** Demandes supplémentaires acceptées, à reprendre dans un avenant. */
  changeRequests: readonly { id: string; title: string; amountCents: number | null }[];
  isAmendment: boolean;
  hasOpportunity: boolean;
  /** Ce que le client accepte : la dernière version envoyée, pas un brouillon en préparation. */
  acceptedVersionLabel: string | null;
}

type FormAction = (state: ActionState, data: FormData) => Promise<ActionState>;

/** Action sans saisie : un bouton, une Server Action, un message éphémère. */
function useQuickAction(action: FormAction, quoteId: string) {
  const toast = useToast();
  const [pending, start] = useTransition();
  return {
    pending,
    run: () =>
      start(async () => {
        const data = new FormData();
        data.set("quoteId", quoteId);
        const result = await action(IDLE_ACTION_STATE, data);
        if (result.status === "success") toast({ message: result.message, tone: "success" });
        if (result.status === "error") toast({ message: result.message, tone: "danger" });
      }),
  };
}

/** Ferme la fenêtre dès que l'action a réussi. Le message reste en notification. */
function useCloseOnSuccess(state: ActionState, close: () => void) {
  useActionToast(state);
  useEffect(() => {
    if (state.status === "success") close();
  }, [state, close]);
}

// --- Envoyer à signer ----------------------------------------------------------------------------

function SendDialog({ props, onClose }: { props: QuoteActionsProps; onClose: () => void }) {
  const [state, action] = useActionState(sendForSignatureAction, IDLE_ACTION_STATE);
  const [manualState, manualAction] = useActionState(markSentManuallyAction, IDLE_ACTION_STATE);
  useCloseOnSuccess(state, onClose);
  useCloseOnSuccess(manualState, onClose);
  const signable = props.signers.filter((signer) => signer.email);
  const defaultSigner = signable.some((signer) => signer.id === props.defaultSignerId)
    ? (props.defaultSignerId ?? undefined)
    : signable[0]?.id;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Envoyer ${props.number}`}
      description={
        props.signatureConfigured
          ? "DocuSeal envoie le devis par e-mail à la personne choisie, et la signature revient ici."
          : undefined
      }
      width={520}
    >
      <ModalRow className="flex flex-col gap-4">
        {props.signatureConfigured ? (
          signable.length > 0 ? (
            <form action={action} className="flex flex-col gap-4">
              <input type="hidden" name="quoteId" value={props.quoteId} />
              <FormAlert state={state} />
              <SelectField
                state={state}
                name="signerContactId"
                label="Personne qui signe"
                defaultValue={defaultSigner}
                data-autofocus
              >
                {signable.map((signer) => (
                  <option key={signer.id} value={signer.id}>
                    {signer.fullName} · {signer.email}
                  </option>
                ))}
              </SelectField>
              <div className="flex justify-end">
                <SubmitButton>Envoyer à signer</SubmitButton>
              </div>
            </form>
          ) : (
            <p className="rounded-md bg-warn-pale px-4 py-3 text-sm text-warn">
              Aucun contact de ce client n’a d’adresse e-mail. Complétez sa fiche, ou envoyez le
              devis vous-même.
            </p>
          )
        ) : (
          <ConnectionRequired
            compact
            service="DocuSeal"
            missing="L'adresse et la clé d'API de DocuSeal ne sont pas renseignées. La signature électronique n'est donc pas disponible."
          />
        )}
      </ModalRow>
      {/* Version déjà envoyée : seule une nouvelle signature a un sens ici. */}
      {props.actions.send ? (
        <ModalRow className="flex flex-col gap-3 border-t border-border pt-4">
          <div>
            <h3 className="text-tile-title text-ink">Envoyé par vos soins</h3>
            <p className="mt-1 text-sm text-muted">
              Vous transmettez le devis vous-même, par e-mail ou depuis Indy. Il passera en « Envoyé
              », et vous enregistrerez la signature à sa réception, avec la référence du document
              signé.
            </p>
          </div>
          <FormAlert state={manualState} />
          <form action={manualAction} className="flex justify-end">
            <input type="hidden" name="quoteId" value={props.quoteId} />
            <SubmitButton variant="default">Marquer comme envoyé</SubmitButton>
          </form>
        </ModalRow>
      ) : null}
    </Modal>
  );
}

/** Action principale de l'écran 09 : à droite d'« Aperçu PDF », en Accent. */
export function QuotePrimaryAction(props: QuoteActionsProps) {
  const [sending, setSending] = useState(false);
  const check = useQuickAction(checkSignatureAction, props.quoteId);
  if (!props.canSend) return null;
  const { actions, signatureConfigured } = props;
  // Sans DocuSeal, une version déjà envoyée n'a rien à redemander ni à vérifier : pas de bouton mort.
  if (actions.send || (actions.requestSignature && signatureConfigured)) {
    return (
      <>
        <Button variant="accent" onClick={() => setSending(true)}>
          {actions.send ? "Envoyer à signer" : "Demander la signature"}
        </Button>
        {sending ? <SendDialog props={props} onClose={() => setSending(false)} /> : null}
      </>
    );
  }
  if (actions.checkSignature && signatureConfigured) {
    return (
      <Button variant="accent" loading={check.pending} onClick={check.run}>
        Vérifier la signature
      </Button>
    );
  }
  return null;
}

// --- Décisions ---------------------------------------------------------------------------------

function AcceptDialog({ props, onClose }: { props: QuoteActionsProps; onClose: () => void }) {
  const [state, action] = useActionState(acceptManuallyAction, IDLE_ACTION_STATE);
  useCloseOnSuccess(state, onClose);
  const effect = props.isAmendment
    ? "L'avenant passera en accepté, sans nouveau projet."
    : props.hasOpportunity
      ? "L'affaire passera en gagnée et le projet sera créé."
      : "Le projet sera créé.";
  return (
    <Modal
      open
      onClose={onClose}
      title="Enregistrer l'acceptation"
      description={`Le client a signé hors DocuSeal. Désignez le document signé. ${effect}`}
      width={520}
    >
      <ModalRow>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="quoteId" value={props.quoteId} />
          <FormAlert state={state} />
          {props.acceptedVersionLabel ? (
            <p className="rounded-md bg-surface-raised px-4 py-3 text-sm text-text">
              {props.acceptedVersionLabel}
            </p>
          ) : null}
          <TextField
            state={state}
            name="indyReference"
            label="Référence du document signé"
            hint="Numéro Indy, ou référence du contrat papier."
            defaultValue={props.indyReference ?? ""}
            data-autofocus
          />
          <TextField
            state={state}
            name="officialDocumentUrl"
            label="Adresse du document"
            type="url"
            placeholder="https://"
            defaultValue={props.officialDocumentUrl ?? ""}
          />
          <DateField
            state={state}
            name="signedOn"
            label="Signé le"
            defaultValue={props.today}
            max={props.today}
            required
          />
          <TextareaField state={state} name="note" label="Note" rows={2} />
          <div className="flex flex-wrap justify-end gap-3">
            <Button onClick={onClose}>Annuler</Button>
            <SubmitButton>Enregistrer l’acceptation</SubmitButton>
          </div>
        </form>
      </ModalRow>
    </Modal>
  );
}

function RefuseDialog({ props, onClose }: { props: QuoteActionsProps; onClose: () => void }) {
  const [state, action] = useActionState(refuseQuoteAction, IDLE_ACTION_STATE);
  useCloseOnSuccess(state, onClose);
  return (
    <Modal open onClose={onClose} title={`Refus de ${props.number}`} width={480}>
      <ModalRow>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="quoteId" value={props.quoteId} />
          <FormAlert state={state} />
          <TextareaField
            state={state}
            name="reason"
            label="Motif du refus"
            rows={3}
            required
            data-autofocus
          />
          <div className="flex flex-wrap justify-end gap-3">
            <Button onClick={onClose}>Annuler</Button>
            <SubmitButton>Enregistrer le refus</SubmitButton>
          </div>
        </form>
      </ModalRow>
    </Modal>
  );
}

function ReferencesDialog({ props, onClose }: { props: QuoteActionsProps; onClose: () => void }) {
  const [state, action] = useActionState(updateReferencesAction, IDLE_ACTION_STATE);
  useCloseOnSuccess(state, onClose);
  return (
    <Modal
      open
      onClose={onClose}
      title="Document officiel"
      description="Le document légal est émis dans Indy. Nuera OS garde sa référence et son adresse."
      width={480}
    >
      <ModalRow>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="quoteId" value={props.quoteId} />
          <FormAlert state={state} />
          <TextField
            state={state}
            name="indyReference"
            label="Référence Indy"
            defaultValue={props.indyReference ?? ""}
            data-autofocus
          />
          <TextField
            state={state}
            name="officialDocumentUrl"
            label="Adresse du document"
            type="url"
            placeholder="https://"
            defaultValue={props.officialDocumentUrl ?? ""}
          />
          <div className="flex flex-wrap justify-end gap-3">
            <Button onClick={onClose}>Annuler</Button>
            <SubmitButton>Enregistrer</SubmitButton>
          </div>
        </form>
      </ModalRow>
    </Modal>
  );
}

function AmendmentDialog({ props, onClose }: { props: QuoteActionsProps; onClose: () => void }) {
  const [state, action] = useActionState(createAmendmentAction, IDLE_ACTION_STATE);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Avenant à ${props.number}`}
      description="Un nouveau devis, lié à celui-ci, pour un changement de prix, de délai ou de périmètre. Le projet déjà lancé n'est pas recréé."
      width={480}
    >
      <ModalRow>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="quoteId" value={props.quoteId} />
          <FormAlert state={state} />
          <TextField
            state={state}
            name="title"
            label="Objet de l'avenant"
            placeholder="Page supplémentaire"
            required
            data-autofocus
          />
          {props.changeRequests.length > 0 ? (
            <SelectField
              state={state}
              name="changeRequestId"
              label="Demande supplémentaire"
              hint="Facultatif : son montant et son temps deviennent la première ligne de l'avenant."
              defaultValue=""
            >
              <option value="">Aucune</option>
              {props.changeRequests.map((request) => (
                <option key={request.id} value={request.id}>
                  {request.title}
                  {request.amountCents === null ? "" : ` · ${formatCents(request.amountCents)}`}
                </option>
              ))}
            </SelectField>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button onClick={onClose}>Annuler</Button>
            <SubmitButton>Créer l’avenant</SubmitButton>
          </div>
        </form>
      </ModalRow>
    </Modal>
  );
}

type OpenDialog = "accept" | "refuse" | "references" | "amend" | "archive" | "expire" | null;

/** Décisions du suivi : chaque bouton n'existe que si la machine à états l'autorise. */
export function QuoteDecisionActions(props: QuoteActionsProps) {
  const { actions, canUpdate, canCreate, quoteId } = props;
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const close = () => setDialog(null);
  const negotiate = useQuickAction(negotiationAction, quoteId);
  const toast = useToast();

  async function confirmWith(action: FormAction) {
    const data = new FormData();
    data.set("quoteId", quoteId);
    const result = await action(IDLE_ACTION_STATE, data);
    if (result.status === "error") toast({ message: result.message, tone: "danger" });
    if (result.status === "success") toast({ message: result.message, tone: "success" });
    close();
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canUpdate && actions.accept ? (
          <CompactButton onClick={() => setDialog("accept")}>
            Enregistrer l’acceptation
          </CompactButton>
        ) : null}
        {canUpdate && actions.negotiate ? (
          <CompactButton variant="secondary" loading={negotiate.pending} onClick={negotiate.run}>
            Passer en négociation
          </CompactButton>
        ) : null}
        {canUpdate && actions.refuse ? (
          <CompactButton variant="secondary" onClick={() => setDialog("refuse")}>
            Enregistrer un refus
          </CompactButton>
        ) : null}
        {canUpdate && actions.expire ? (
          <CompactButton variant="secondary" onClick={() => setDialog("expire")}>
            Marquer comme expiré
          </CompactButton>
        ) : null}
        {canCreate && actions.amend ? (
          <CompactButton variant="secondary" onClick={() => setDialog("amend")}>
            Créer un avenant
          </CompactButton>
        ) : null}
        {canUpdate ? (
          <CompactButton variant="secondary" onClick={() => setDialog("references")}>
            Document officiel
          </CompactButton>
        ) : null}
        {canUpdate && actions.archive ? (
          <CompactButton variant="quiet" onClick={() => setDialog("archive")}>
            Archiver
          </CompactButton>
        ) : null}
      </div>

      {dialog === "accept" ? <AcceptDialog props={props} onClose={close} /> : null}
      {dialog === "refuse" ? <RefuseDialog props={props} onClose={close} /> : null}
      {dialog === "references" ? <ReferencesDialog props={props} onClose={close} /> : null}
      {dialog === "amend" ? <AmendmentDialog props={props} onClose={close} /> : null}
      <ConfirmDialog
        open={dialog === "expire"}
        title="Marquer ce devis comme expiré ?"
        description="Sa date de validité est dépassée. Il ne pourra plus être signé."
        confirmLabel="Marquer comme expiré"
        onCancel={close}
        onConfirm={() => confirmWith(expireQuoteAction)}
      />
      <ConfirmDialog
        open={dialog === "archive"}
        title="Archiver ce devis ?"
        description="Il disparaît des listes. L'historique reste conservé."
        confirmLabel="Archiver"
        tone="danger"
        onCancel={close}
        onConfirm={() => confirmWith(archiveQuoteAction)}
      />
    </>
  );
}

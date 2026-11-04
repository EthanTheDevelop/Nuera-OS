"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { ConnectionRequired } from "@/components/states/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox, FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { DurationField, MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { SIGNATURE_STATUS_LABELS, SIGNATURE_STATUSES } from "@/lib/domain-enums";
import {
  addContractNoteAction,
  convertOverageAction,
  linkContractSiteAction,
  refreshContractSignatureAction,
  requestContractSignatureAction,
  unlinkContractSiteAction,
  updateContractSignatureAction,
} from "../contract.actions";
import type { ContractDetail, ContractSiteRow, SiteOption } from "../contract.types";
import { useModalForm } from "./use-modal-form";

// --- Sites couverts ----------------------------------------------------------------------------

function LinkSiteForm({
  contractId,
  options,
  onDone,
}: {
  contractId: string;
  options: readonly SiteOption[];
  onDone: () => void;
}) {
  const { state, formAction } = useModalForm(linkContractSiteAction.bind(null, contractId), onDone);
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        <SelectField state={state} name="siteId" label="Site du client" defaultValue="" required>
          <option value="" disabled>
            Choisir un site
          </option>
          {options.map((site) => (
            <option key={site.id} value={site.id}>
              {site.primaryDomain ?? site.name}
            </option>
          ))}
        </SelectField>
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>Rattacher</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

export function ContractSites({
  contractId,
  sites,
  options,
  canEdit,
}: {
  contractId: string;
  sites: readonly ContractSiteRow[];
  options: readonly SiteOption[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ContractSiteRow | null>(null);
  const toast = useToast();
  const close = useCallback(() => setAdding(false), []);
  const linked = new Set(sites.map((site) => site.siteId));
  const available = options.filter((site) => !linked.has(site.id));

  async function confirmRemoval() {
    if (!removing) return;
    const result = await unlinkContractSiteAction(contractId, removing.siteId);
    toast({
      message: result.status === "idle" ? "" : result.message,
      tone: result.status === "error" ? "danger" : "success",
    });
    setRemoving(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {sites.length === 0 ? (
        <p className="text-sm text-muted">
          Aucun site rattaché : le contrat vaut pour tous les sites du client.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sites.map((site) => (
            <li key={site.siteId} className="flex items-center justify-between gap-2">
              <Link
                href={`/sites/${site.siteId}`}
                className="min-w-0 truncate text-sm text-text hover:underline hover:underline-offset-4"
              >
                {site.primaryDomain ?? site.name}
              </Link>
              <span className="flex shrink-0 items-center gap-2">
                <StatusBadge kind="site" status={site.status} />
                {canEdit && site.removable ? (
                  <CompactButton
                    variant="quiet"
                    aria-label={`Retirer ${site.primaryDomain ?? site.name}`}
                    onClick={() => setRemoving(site)}
                  >
                    Retirer
                  </CompactButton>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && sites.some((site) => !site.removable) ? (
        <p className="text-xs text-muted">
          Un site sans « Retirer » porte ce contrat sur sa fiche : le lien se modifie depuis
          celle-ci.
        </p>
      ) : null}
      {canEdit ? (
        available.length > 0 ? (
          <div>
            <CompactButton variant="secondary" icon="plus" onClick={() => setAdding(true)}>
              Rattacher un site
            </CompactButton>
          </div>
        ) : sites.length === 0 ? (
          <p className="text-xs text-muted">Ce client n&apos;a encore aucun site.</p>
        ) : null
      ) : null}
      <Modal open={adding} onClose={close} title="Rattacher un site" icon="sites" width={480}>
        <LinkSiteForm contractId={contractId} options={available} onDone={close} />
      </Modal>
      <ConfirmDialog
        open={removing !== null}
        title="Retirer ce site du contrat"
        description={`${removing?.primaryDomain ?? removing?.name ?? ""} ne sera plus couvert par ce contrat. S'il ne reste aucun site, le contrat vaudra pour tous les sites du client.`}
        confirmLabel="Retirer"
        onConfirm={confirmRemoval}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

// --- Signature ---------------------------------------------------------------------------------

function ManualSignatureForm({
  contract,
  onDone,
}: {
  contract: ContractDetail;
  onDone: () => void;
}) {
  const { state, formAction } = useModalForm(
    updateContractSignatureAction.bind(null, contract.id),
    onDone,
  );
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          À utiliser pour un contrat signé hors de Nuera OS. Cette saisie ne déclenche aucune
          signature.
        </p>
        <FormAlert state={state} />
        <SelectField
          state={state}
          name="status"
          label="État de la signature"
          defaultValue={contract.signatureStatus}
        >
          {SIGNATURE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {SIGNATURE_STATUS_LABELS[status]}
            </option>
          ))}
        </SelectField>
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>Enregistrer</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

function SendForSignatureForm({
  contract,
  contacts,
  onDone,
}: {
  contract: ContractDetail;
  contacts: readonly { id: string; fullName: string; email: string | null }[];
  onDone: () => void;
}) {
  const { state, formAction } = useModalForm(
    requestContractSignatureAction.bind(null, contract.id),
    onDone,
  );
  const withEmail = contacts.filter((contact) => contact.email);
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        {withEmail.length === 0 ? (
          <p className="text-sm text-muted">
            Aucun contact de ce client n&apos;a d&apos;adresse e-mail. Complétez sa fiche
            d&apos;abord.
          </p>
        ) : (
          <SelectField
            state={state}
            name="signerContactId"
            label="Personne qui signe"
            hint="DocuSeal lui envoie la demande par e-mail."
            defaultValue=""
            required
          >
            <option value="" disabled>
              Choisir un contact
            </option>
            {withEmail.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.fullName} · {contact.email}
              </option>
            ))}
          </SelectField>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          {withEmail.length > 0 ? <SubmitButton>Envoyer à signer</SubmitButton> : null}
        </div>
      </form>
    </ModalRow>
  );
}

export function ContractSignature({
  contract,
  contacts,
  configured,
  canEdit,
}: {
  contract: ContractDetail;
  contacts: readonly { id: string; fullName: string; email: string | null }[];
  configured: boolean;
  canEdit: boolean;
}) {
  const [dialog, setDialog] = useState<"manual" | "send" | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const toast = useToast();
  const close = useCallback(() => setDialog(null), []);
  const ended = contract.status === "terminated" || contract.status === "expired";
  const editable = canEdit && !ended;
  const pending = contract.signatureStatus === "pending" && contract.docusealSubmissionId !== null;

  function refresh() {
    startRefresh(async () => {
      const result = await refreshContractSignatureAction(contract.id);
      if (result.status === "idle") return;
      toast({ message: result.message, tone: result.status === "error" ? "danger" : "success" });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 text-sm text-text">
        <span>État</span>
        <StatusBadge kind="signature" status={contract.signatureStatus} />
      </div>
      {contract.docusealSubmissionId ? (
        <p className="text-xs text-muted">
          Demande DocuSeal <span className="font-mono">{contract.docusealSubmissionId}</span>
        </p>
      ) : null}
      {editable && !configured && contract.signatureStatus !== "signed" ? (
        <ConnectionRequired
          compact
          service="DocuSeal"
          missing="L'envoi à la signature n'est pas disponible. L'état se saisit à la main."
        />
      ) : null}
      {editable ? (
        <div className="flex flex-wrap gap-2">
          {configured && !pending && contract.signatureStatus !== "signed" ? (
            <CompactButton variant="secondary" onClick={() => setDialog("send")}>
              Envoyer à signer
            </CompactButton>
          ) : null}
          {configured && contract.docusealSubmissionId ? (
            <CompactButton variant="secondary" loading={refreshing} onClick={refresh}>
              Vérifier la signature
            </CompactButton>
          ) : null}
          <CompactButton variant="quiet" onClick={() => setDialog("manual")}>
            Saisir l&apos;état
          </CompactButton>
        </div>
      ) : null}
      <Modal
        open={dialog === "manual"}
        onClose={close}
        title="État de la signature"
        icon="devis"
        width={480}
      >
        <ManualSignatureForm contract={contract} onDone={close} />
      </Modal>
      <Modal
        open={dialog === "send"}
        onClose={close}
        title="Envoyer à signer"
        icon="send"
        width={480}
      >
        <SendForSignatureForm contract={contract} contacts={contacts} onDone={close} />
      </Modal>
    </div>
  );
}

// --- Note et hors forfait ----------------------------------------------------------------------

function NoteForm({ contractId, onDone }: { contractId: string; onDone: () => void }) {
  const { state, formAction } = useModalForm(addContractNoteAction.bind(null, contractId), onDone);
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        <TextareaField state={state} name="note" label="Note" rows={4} required data-autofocus />
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>Ajouter</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

export function AddNoteButton({ contractId }: { contractId: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <CompactButton variant="quiet" onClick={() => setOpen(true)}>
        Ajouter une note
      </CompactButton>
      <Modal open={open} onClose={close} title="Ajouter une note" icon="edit" width={480}>
        <NoteForm contractId={contractId} onDone={close} />
      </Modal>
    </>
  );
}

function OverageForm({
  contractId,
  canQuote,
  onDone,
}: {
  contractId: string;
  canQuote: boolean;
  onDone: () => void;
}) {
  const { state, formAction } = useModalForm(convertOverageAction.bind(null, contractId), onDone);
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Le travail hors forfait ne se fait pas gratuitement : il devient une demande de changement
          du client, à accepter ou à chiffrer.
        </p>
        <FormAlert state={state} />
        <TextField state={state} name="title" label="Travail demandé" required data-autofocus />
        <TextareaField state={state} name="description" label="Détail" rows={3} />
        <div className="grid gap-4 sm:grid-cols-2">
          <DurationField state={state} name="estimatedMinutes" label="Temps estimé" />
          <MoneyField state={state} name="amountCents" label="Montant HT" />
        </div>
        {canQuote ? (
          <Checkbox
            name="withQuote"
            label="Créer aussi un devis brouillon"
            description="Vous êtes conduit vers le devis pour le compléter."
          />
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>Transformer</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

export function OverageButton({
  contractId,
  canQuote,
  prominent,
}: {
  contractId: string;
  canQuote: boolean;
  /** Le quota est atteint : l'action devient celle de la carte. */
  prominent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <CompactButton variant={prominent ? "primary" : "secondary"} onClick={() => setOpen(true)}>
        Transformer du hors forfait
      </CompactButton>
      <Modal open={open} onClose={close} title="Travail hors forfait" icon="flag" width={560}>
        <OverageForm contractId={contractId} canQuote={canQuote} onDone={close} />
      </Modal>
    </>
  );
}

"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox, DateField, FormAlert, SelectField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE, submittedValue, type ActionState } from "@/lib/action-state";
import {
  checkDomainTlsAction,
  createDomainAction,
  deleteDomainAction,
  loadCompanyLinksAction,
  updateDomainAction,
} from "../site.actions";
import { LinkSelect, type LinkOption } from "./site-form";

export interface DomainFormValues {
  id: string;
  name: string;
  companyId: string;
  siteId: string | null;
  siteName: string | null;
  registrar: string | null;
  expiresOn: string | null;
  autoRenew: boolean;
}

/** Ajout ou modification d'un domaine. Échéance saisie à la main : pas d'API de registrar ici. */
export function DomainFormButton({
  domain,
  siteId,
  companyId,
  companies,
  label,
  primary = false,
}: {
  domain?: DomainFormValues;
  /** Ajout depuis la fiche d'un site : client et site sont déjà connus. */
  siteId?: string;
  companyId?: string;
  /** Ajout depuis la liste des domaines : le client se choisit. */
  companies?: readonly { id: string; name: string }[];
  label: string;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {primary ? (
        <Button variant="accent" icon="plus" onClick={() => setOpen(true)}>
          {label}
        </Button>
      ) : (
        <CompactButton variant="quiet" onClick={() => setOpen(true)}>
          {label}
        </CompactButton>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={domain ? `Modifier ${domain.name}` : "Ajouter un domaine"}
        width={560}
      >
        <DomainForm
          domain={domain}
          siteId={siteId}
          companyId={companyId}
          companies={companies}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

function DomainForm({
  domain,
  siteId,
  companyId,
  companies,
  onDone,
}: {
  domain?: DomainFormValues;
  siteId?: string;
  companyId?: string;
  companies?: readonly { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    domain ? updateDomainAction : createDomainAction,
    IDLE_ACTION_STATE,
  );
  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  // Depuis la fiche d'un site, le site est connu. Sinon il se choisit parmi ceux du client.
  const fixedSite = !domain && siteId ? siteId : null;
  const [selectedCompany, setSelectedCompany] = useState(domain?.companyId ?? companyId ?? "");
  const [sites, setSites] = useState<LinkOption[]>([]);
  const [loadingSites, startLoading] = useTransition();
  useEffect(() => {
    if (fixedSite || !selectedCompany) return;
    startLoading(async () => {
      setSites((await loadCompanyLinksAction(selectedCompany)).sites);
    });
  }, [fixedSite, selectedCompany]);

  const autoRenew =
    state.status === "error"
      ? submittedValue(state, "autoRenew") === "on"
      : (domain?.autoRenew ?? false);

  return (
    <form action={action} className="contents">
      {domain ? <input type="hidden" name="id" value={domain.id} /> : null}
      {fixedSite ? <input type="hidden" name="siteId" value={fixedSite} /> : null}
      {!domain && companyId ? <input type="hidden" name="companyId" value={companyId} /> : null}
      <ModalRow>
        <FormAlert state={state} />
      </ModalRow>
      <ModalRow className="flex flex-col gap-4">
        {domain ? null : (
          <TextField
            state={state}
            name="name"
            label="Nom de domaine"
            placeholder="exemple.fr"
            autoCapitalize="off"
            spellCheck={false}
            required
            data-autofocus
          />
        )}
        {!domain && companies ? (
          <SelectField
            state={state}
            name="companyId"
            label="Client"
            required
            defaultValue=""
            onChange={(event) => setSelectedCompany(event.target.value)}
          >
            <option value="">Choisir un client</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        {fixedSite ? null : (
          <LinkSelect
            key={`${selectedCompany}-${sites.length}`}
            state={state}
            name="siteId"
            label="Site"
            options={sites}
            value={domain?.siteId ?? ""}
            valueLabel={domain?.siteName}
            disabled={!selectedCompany || loadingSites}
          />
        )}
        <TextField
          state={state}
          name="registrar"
          label="Registrar"
          defaultValue={domain?.registrar ?? ""}
        />
        <DateField
          state={state}
          name="expiresOn"
          label="Date d'expiration"
          hint="Saisie à la main, depuis le compte du registrar."
          defaultValue={domain?.expiresOn ?? ""}
        />
        <Checkbox
          key={String(autoRenew)}
          name="autoRenew"
          label="Renouvellement automatique"
          defaultChecked={autoRenew}
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>Enregistrer</SubmitButton>
      </ModalRow>
    </form>
  );
}

/** Contrôle réel du certificat, depuis le serveur. Le motif d'un échec s'affiche tel quel. */
export function TlsCheckButton({ domainId }: { domainId: string }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <CompactButton
      variant="quiet"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await checkDomainTlsAction(domainId);
          if (result.status === "idle") return;
          toast({
            message: result.message,
            tone: result.status === "success" ? "success" : "danger",
          });
        })
      }
    >
      Vérifier le HTTPS
    </CompactButton>
  );
}

export function DeleteDomainButton({
  domainId,
  domainName,
  siteId,
}: {
  domainId: string;
  domainName: string;
  siteId: string | null;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <CompactButton variant="quiet" className="text-danger" onClick={() => setOpen(true)}>
        Retirer
      </CompactButton>
      <ConfirmDialog
        open={open}
        title={`Retirer ${domainName}`}
        description="Le domaine n'est plus suivi : son échéance et son certificat ne sont plus surveillés. L'opération est tracée dans le journal."
        confirmLabel="Retirer"
        tone="danger"
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          const result = await deleteDomainAction(domainId, siteId);
          if (result.status === "idle") return;
          toast({
            message: result.message,
            tone: result.status === "success" ? "success" : "danger",
          });
          setOpen(false);
        }}
      />
    </>
  );
}

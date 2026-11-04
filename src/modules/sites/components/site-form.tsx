"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import {
  Checkbox,
  DateField,
  Field,
  fieldDescription,
  FormAlert,
  Select,
  SelectField,
  TextField,
} from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import {
  fieldError,
  IDLE_ACTION_STATE,
  submittedValue,
  type ActionState,
} from "@/lib/action-state";
import { CMS_KIND_LABELS, CMS_KINDS, SITE_KIND_LABELS, SITE_KINDS } from "@/lib/domain-enums";
import { createSiteAction, loadCompanyLinksAction, updateSiteAction } from "../site.actions";

export interface SiteFormValues {
  id: string;
  companyId: string;
  companyName: string | null;
  projectId: string | null;
  projectLabel: string | null;
  contractId: string | null;
  contractLabel: string | null;
  name: string;
  primaryDomain: string | null;
  kind: string | null;
  technology: string | null;
  cmsKind: string | null;
  cmsAdminUrl: string | null;
  repoUrl: string | null;
  repoBranch: string | null;
  hostingLabel: string | null;
  hostedByNuera: boolean;
  serverLabel: string | null;
  ownerMemberId: string | null;
  ownerName: string | null;
  liveOn: string | null;
  coolifyProjectUuid: string | null;
  monitorId: string | null;
}

export interface SiteFormChoices {
  companies: readonly { id: string; name: string }[];
  members: readonly { id: string; fullName: string }[];
}

export interface LinkOption {
  id: string;
  label: string;
}

/** Création (`site` absent) ou modification. Le client ne change plus après la création. */
export function SiteFormButton({
  site,
  choices,
  label,
  compact = false,
}: {
  site?: SiteFormValues;
  choices: SiteFormChoices;
  label: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <CompactButton variant="quiet" onClick={() => setOpen(true)}>
          {label}
        </CompactButton>
      ) : (
        <Button variant="accent" icon="plus" onClick={() => setOpen(true)}>
          {label}
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={site ? "Modifier le site" : "Nouveau site"}
        width={720}
      >
        <SiteForm site={site} choices={choices} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function SiteForm({
  site,
  choices,
  onDone,
}: {
  site?: SiteFormValues;
  choices: SiteFormChoices;
  onDone: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    site ? updateSiteAction : createSiteAction,
    IDLE_ACTION_STATE,
  );
  const [companyId, setCompanyId] = useState(site?.companyId ?? "");
  const [links, setLinks] = useState<{ projects: LinkOption[]; contracts: LinkOption[] }>({
    projects: [],
    contracts: [],
  });
  const [loadingLinks, startLoading] = useTransition();

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  useEffect(() => {
    if (!companyId) return;
    startLoading(async () => {
      setLinks(await loadCompanyLinksAction(companyId));
    });
  }, [companyId]);

  // Un responsable parti n'est plus proposé : il reste sélectionné tant que personne ne le change.
  const owner = site?.ownerMemberId ?? "";
  const ownerKnown = choices.members.some((member) => member.id === owner);

  const returned = submittedValue(state, "hostedByNuera");
  const hosted = state.status === "error" ? returned === "on" : (site?.hostedByNuera ?? true);

  return (
    <form action={action} className="contents">
      {site ? <input type="hidden" name="id" value={site.id} /> : null}
      <ModalRow>
        <FormAlert state={state} />
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="name"
          label="Nom du site"
          required
          defaultValue={site?.name}
          data-autofocus
        />
        <TextField
          state={state}
          name="primaryDomain"
          label="Domaine principal"
          placeholder="exemple.fr"
          autoCapitalize="off"
          spellCheck={false}
          defaultValue={site?.primaryDomain ?? ""}
        />
        {site ? (
          <TextField
            name="companyLabel"
            label="Client"
            disabled
            defaultValue={site.companyName ?? ""}
          />
        ) : (
          <Field id="companyId" label="Client" error={fieldError(state, "companyId")}>
            <Select
              id="companyId"
              name="companyId"
              required
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              {...fieldDescription("companyId", { error: fieldError(state, "companyId") })}
            >
              <option value="">Choisir un client</option>
              {choices.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <SelectField
          state={state}
          name="ownerMemberId"
          label="Responsable"
          defaultValue={site?.ownerMemberId ?? ""}
        >
          <option value="">Personne</option>
          {owner && !ownerKnown ? (
            <option value={owner}>{site?.ownerName ?? "Responsable actuel"}</option>
          ) : null}
          {choices.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </SelectField>
        <LinkSelect
          key={`project-${companyId}-${links.projects.length}`}
          state={state}
          name="projectId"
          label="Projet"
          options={links.projects}
          value={site?.projectId ?? ""}
          valueLabel={site?.projectLabel}
          disabled={!companyId || loadingLinks}
        />
        <LinkSelect
          key={`contract-${companyId}-${links.contracts.length}`}
          state={state}
          name="contractId"
          label="Contrat"
          options={links.contracts}
          value={site?.contractId ?? ""}
          valueLabel={site?.contractLabel}
          disabled={!companyId || loadingLinks}
        />
        <SelectField state={state} name="kind" label="Type" defaultValue={site?.kind ?? ""}>
          <option value="">Non précisé</option>
          {SITE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {SITE_KIND_LABELS[kind]}
            </option>
          ))}
        </SelectField>
        <TextField
          state={state}
          name="technology"
          label="Technologie"
          placeholder="Next.js"
          defaultValue={site?.technology ?? ""}
        />
        <SelectField state={state} name="cmsKind" label="CMS" defaultValue={site?.cmsKind ?? ""}>
          <option value="">Non précisé</option>
          {CMS_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {CMS_KIND_LABELS[kind]}
            </option>
          ))}
        </SelectField>
        <TextField
          state={state}
          name="cmsAdminUrl"
          label="Administration du CMS"
          hint="Lien seulement : le contenu reste dans le CMS."
          type="url"
          placeholder="https://"
          defaultValue={site?.cmsAdminUrl ?? ""}
        />
        <TextField
          state={state}
          name="repoUrl"
          label="Dépôt"
          type="url"
          placeholder="https://"
          defaultValue={site?.repoUrl ?? ""}
        />
        <TextField
          state={state}
          name="repoBranch"
          label="Branche déployée"
          placeholder="main"
          defaultValue={site?.repoBranch ?? ""}
        />
        <TextField
          state={state}
          name="hostingLabel"
          label="Hébergement"
          defaultValue={site?.hostingLabel ?? ""}
        />
        <TextField
          state={state}
          name="serverLabel"
          label="Serveur"
          defaultValue={site?.serverLabel ?? ""}
        />
        <TextField
          state={state}
          name="coolifyProjectUuid"
          label="Projet Coolify (UUID)"
          hint="Sert au lien vers la console. L'application se relie par environnement."
          autoCapitalize="off"
          spellCheck={false}
          defaultValue={site?.coolifyProjectUuid ?? ""}
        />
        <TextField
          state={state}
          name="monitorId"
          label="Sonde Uptime Kuma"
          hint="Identifiant de la sonde, présente sur la page de statut publiée."
          autoCapitalize="off"
          spellCheck={false}
          defaultValue={site?.monitorId ?? ""}
        />
        <DateField
          state={state}
          name="liveOn"
          label="Date de mise en ligne"
          defaultValue={site?.liveOn ?? ""}
        />
        <Checkbox
          key={String(hosted)}
          name="hostedByNuera"
          label="Hébergé par nous"
          defaultChecked={hosted}
          className="self-end"
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>{site ? "Enregistrer" : "Créer le site"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

/**
 * Lien vers un objet du client. Enregistrer ne doit jamais effacer un lien en silence : le choix en
 * place reste envoyé pendant le chargement (un champ désactivé n'est pas soumis), et reste proposé
 * s'il n'est plus dans la liste (projet archivé, lecture en échec).
 */
export function LinkSelect({
  state,
  name,
  label,
  options,
  value,
  valueLabel,
  disabled,
}: {
  state: ActionState;
  name: string;
  label: string;
  options: readonly LinkOption[];
  value: string;
  valueLabel?: string | null;
  disabled: boolean;
}) {
  const known = options.some((option) => option.id === value);
  return (
    <>
      {disabled && value ? <input type="hidden" name={name} value={value} /> : null}
      <SelectField state={state} name={name} label={label} defaultValue={value} disabled={disabled}>
        <option value="">Aucun</option>
        {value && !known ? <option value={value}>{valueLabel ?? "Lien actuel"}</option> : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </SelectField>
    </>
  );
}

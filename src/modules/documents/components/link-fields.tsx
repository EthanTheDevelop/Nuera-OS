"use client";

import { useEffect, useState, useTransition } from "react";
import { Field, fieldDescription, Select } from "@/components/ui/form";
import { fieldError, type ActionState } from "@/lib/action-state";
import { loadDocumentLinkOptionsAction } from "../document.actions";
import type { CompanyLinkOptions, LinkOption } from "../document.types";

const NO_OPTIONS: CompanyLinkOptions = {
  projects: [],
  contracts: [],
  sites: [],
  tickets: [],
  quotes: [],
};

export interface LinkValues {
  companyId?: string | null;
  projectId?: string | null;
  contractId?: string | null;
  siteId?: string | null;
  ticketId?: string | null;
  quoteId?: string | null;
}

const LINK_SELECTS = [
  { name: "projectId", label: "Projet", options: "projects" },
  { name: "contractId", label: "Contrat", options: "contracts" },
  { name: "siteId", label: "Site", options: "sites" },
  { name: "ticketId", label: "Demande", options: "tickets" },
  { name: "quoteId", label: "Devis", options: "quotes" },
] as const;

function LinkSelect({
  id,
  name,
  label,
  value,
  options,
  error,
  disabled,
  onChange,
}: {
  id: string;
  name?: string;
  label: string;
  value: string;
  options: readonly LinkOption[];
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label} error={error}>
      <Select
        id={id}
        name={name}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        {...fieldDescription(id, { error })}
      >
        <option value="">Aucun</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/**
 * Rattachement d'un document : le client, puis ses projets, contrats, sites, demandes et devis.
 * Changer de client vide les liens : un objet d'un autre client n'est jamais proposé.
 */
export function LinkFields({
  companies,
  initial = {},
  initialOptions,
  state,
  disabled = false,
}: {
  companies: readonly { id: string; name: string }[];
  initial?: LinkValues;
  initialOptions?: CompanyLinkOptions;
  state?: ActionState;
  disabled?: boolean;
}) {
  const [companyId, setCompanyId] = useState(initial.companyId ?? "");
  const [links, setLinks] = useState<Record<string, string>>({
    projectId: initial.projectId ?? "",
    contractId: initial.contractId ?? "",
    siteId: initial.siteId ?? "",
    ticketId: initial.ticketId ?? "",
    quoteId: initial.quoteId ?? "",
  });
  const [options, setOptions] = useState(initialOptions ?? NO_OPTIONS);
  const [pending, startTransition] = useTransition();
  const companyError = state ? fieldError(state, "companyId") : undefined;

  useEffect(() => {
    if (!companyId || initialOptions) return;
    let cancelled = false;
    startTransition(async () => {
      const loaded = await loadDocumentLinkOptionsAction(companyId);
      if (!cancelled) setOptions(loaded ?? NO_OPTIONS);
    });
    return () => {
      cancelled = true;
    };
    // Une seule fois : un client déjà choisi à l'ouverture, sans options fournies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeCompany(next: string) {
    setCompanyId(next);
    setLinks({ projectId: "", contractId: "", siteId: "", ticketId: "", quoteId: "" });
    setOptions(NO_OPTIONS);
    if (!next) return;
    startTransition(async () => {
      setOptions((await loadDocumentLinkOptionsAction(next)) ?? NO_OPTIONS);
    });
  }

  return (
    <>
      {/* Un champ désactivé n'est pas envoyé : sans ces valeurs, le serveur lirait « aucun lien ». */}
      {disabled ? (
        <>
          <input type="hidden" name="companyId" value={companyId} />
          {LINK_SELECTS.map((link) => (
            <input key={link.name} type="hidden" name={link.name} value={links[link.name] ?? ""} />
          ))}
        </>
      ) : null}
      <Field id="companyId" label="Client" error={companyError} className="sm:col-span-2">
        <Select
          id="companyId"
          name={disabled ? undefined : "companyId"}
          value={companyId}
          disabled={disabled}
          onChange={(event) => changeCompany(event.target.value)}
          {...fieldDescription("companyId", { error: companyError })}
        >
          <option value="">Aucun : document interne à l&apos;agence</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </Select>
      </Field>
      {companyId
        ? LINK_SELECTS.map((link) => (
            <LinkSelect
              key={link.name}
              id={link.name}
              name={disabled ? undefined : link.name}
              label={link.label}
              value={links[link.name] ?? ""}
              options={options[link.options]}
              disabled={disabled || pending}
              error={state ? fieldError(state, link.name) : undefined}
              onChange={(value) => setLinks((current) => ({ ...current, [link.name]: value }))}
            />
          ))
        : null}
    </>
  );
}

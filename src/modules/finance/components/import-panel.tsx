"use client";

import { useState, useTransition } from "react";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactLink } from "@/components/ui/compact-button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { IMPORT_FIELDS, type ColumnMapping, type ImportField } from "@/integrations/indy/indy.csv";
import { formatCents } from "@/lib/money";
import {
  exportHref,
  IMPORT_FIELD_LABELS,
  IMPORT_TOO_LARGE,
  MAX_IMPORT_BYTES,
  NO_LEGAL_VALUE_NOTICE,
} from "../finance.constants";
import { previewImportAction, runImportAction } from "../finance.actions";
import type { ImportPreview, ImportResult } from "../import.service";

const ACTION_BADGES = {
  create: { label: "À créer", tone: "accent" },
  update: { label: "À mettre à jour", tone: "accent" },
  unchanged: { label: "Inchangée", tone: "neutral" },
  reject: { label: "Refusée", tone: "danger" },
} as const;

const SEND_FAILED = "Le fichier n'a pas pu être envoyé. Vérifiez la connexion, puis réessayez.";

function formFor(file: File, mapping?: ColumnMapping) {
  const data = new FormData();
  data.set("file", file);
  if (mapping) data.set("mapping", JSON.stringify(mapping));
  return data;
}

/**
 * Import d'un fichier Indy en trois temps : choisir le fichier, associer les colonnes et lire
 * l'aperçu (rien n'est écrit), puis importer. Le serveur rejuge tout au moment de l'import.
 */
function ImportFlow({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function loadPreview(nextFile: File, nextMapping?: ColumnMapping) {
    setError(null);
    if (nextFile.size > MAX_IMPORT_BYTES) {
      setError(IMPORT_TOO_LARGE);
      return;
    }
    startTransition(async () => {
      try {
        const response = await previewImportAction(formFor(nextFile, nextMapping));
        if (!response.ok) {
          setError(response.message);
          setPreview(null);
          return;
        }
        setPreview(response.data);
        setMapping(response.data.mapping);
      } catch {
        setError(SEND_FAILED);
        setPreview(null);
      }
    });
  }

  function changeMapping(field: ImportField, column: string) {
    if (!file) return;
    const next = { ...mapping };
    if (column) next[field] = column;
    else delete next[field];
    setMapping(next);
    loadPreview(file, next);
  }

  function runImport() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      try {
        const response = await runImportAction(formFor(file, mapping));
        if (!response.ok) {
          setError(response.message);
          return;
        }
        setResult(response.data);
        toast({ message: "Import terminé." });
      } catch {
        setError(SEND_FAILED);
      }
    });
  }

  if (result) {
    return (
      <>
        <ModalRow>
          <Alert tone={result.rejected > 0 ? "warn" : "success"}>
            {result.total} lignes lues : {result.created} créées, {result.updated} mises à jour,{" "}
            {result.unchanged} inchangées, {result.rejected} refusées.
          </Alert>
        </ModalRow>
        {result.rejections.length > 0 ? (
          <ModalRow>
            <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto text-sm text-text">
              {result.rejections.map((row, index) => (
                <li key={`${row.line}-${index}`}>
                  <span className="font-mono text-xs text-muted">Ligne {row.line}</span>{" "}
                  {row.externalRef ? `${row.externalRef} · ` : ""}
                  {row.message}
                </li>
              ))}
            </ul>
          </ModalRow>
        ) : null}
        <ModalRow className="flex flex-wrap justify-end gap-3">
          {result.rejected > 0 ? (
            <CompactLink
              variant="secondary"
              icon="download"
              href={exportHref("rapport-import", result.importId)}
              prefetch={false}
            >
              Télécharger le rapport
            </CompactLink>
          ) : null}
          <Button variant="accent" onClick={onClose}>
            Fermer
          </Button>
        </ModalRow>
      </>
    );
  }

  return (
    <>
      <ModalRow>
        <Alert tone="warn">{NO_LEGAL_VALUE_NOTICE}</Alert>
      </ModalRow>
      <ModalRow>
        <Field
          id="import-file"
          label="Fichier CSV"
          hint="Enregistré depuis Indy ou un tableur, 900 Ko et 5 000 lignes au plus. Réimporter le même fichier ne crée aucun doublon."
        >
          <Input
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            className="py-2.5"
            data-autofocus
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null;
              setFile(chosen);
              setPreview(null);
              setMapping({});
              if (chosen) loadPreview(chosen);
            }}
          />
        </Field>
      </ModalRow>
      {error ? (
        <ModalRow>
          <Alert tone="danger">{error}</Alert>
        </ModalRow>
      ) : null}
      {preview ? (
        <>
          <ModalRow>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-tile-title text-ink">Colonnes du fichier</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {IMPORT_FIELDS.map((field) => (
                  <Field key={field} id={`map-${field}`} label={IMPORT_FIELD_LABELS[field]}>
                    <Select
                      id={`map-${field}`}
                      value={mapping[field] ?? ""}
                      disabled={pending}
                      onChange={(event) => changeMapping(field, event.target.value)}
                    >
                      <option value="">Non renseigné</option>
                      {preview.headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            </fieldset>
          </ModalRow>
          {preview.missingFields.length > 0 ? (
            <ModalRow>
              <Alert tone="warn">
                À associer pour continuer : {preview.missingFields.join(", ")}.
              </Alert>
            </ModalRow>
          ) : (
            <>
              <ModalRow className="flex flex-wrap gap-2">
                <Badge tone="neutral">{preview.total} lignes</Badge>
                <Badge tone="accent">{preview.creates} à créer</Badge>
                <Badge tone="accent">{preview.updates} à mettre à jour</Badge>
                <Badge tone="neutral">{preview.unchanged} inchangées</Badge>
                <Badge tone={preview.rejected > 0 ? "danger" : "neutral"}>
                  {preview.rejected} refusées
                </Badge>
              </ModalRow>
              <ModalRow>
                <ul className="flex max-h-64 flex-col overflow-y-auto rounded-md border border-border">
                  {preview.rows.map((row, index) => {
                    const badge = ACTION_BADGES[row.action];
                    return (
                      <li
                        key={`${row.line}-${index}`}
                        className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0"
                      >
                        <span className="flex flex-wrap items-center gap-2 text-sm text-text">
                          <span className="font-mono text-xs text-muted">Ligne {row.line}</span>
                          <span className="font-semibold text-ink">{row.externalRef ?? "—"}</span>
                          <span className="min-w-0 truncate">{row.companyName ?? "—"}</span>
                          <span className="tabular ml-auto">{formatCents(row.amountCents)}</span>
                          {row.action !== "reject" && row.status ? (
                            <StatusBadge kind="invoice" status={row.status} />
                          ) : null}
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        </span>
                        {row.errors.length > 0 ? (
                          <span className="text-xs text-danger">{row.errors.join(" ")}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {preview.total > preview.rows.length ? (
                  <p className="mt-2 text-xs text-muted">
                    Aperçu de {preview.rows.length} lignes sur {preview.total}, les refus
                    d&apos;abord.
                  </p>
                ) : null}
              </ModalRow>
            </>
          )}
        </>
      ) : null}
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onClose} disabled={pending}>
          Annuler
        </Button>
        <Button
          variant="accent"
          icon="check"
          loading={pending}
          disabled={
            !preview || preview.missingFields.length > 0 || preview.creates + preview.updates === 0
          }
          onClick={runImport}
        >
          Importer
        </Button>
      </ModalRow>
    </>
  );
}

export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="download"
      title="Importer des factures"
      description="Associez les colonnes de votre fichier, lisez l'aperçu, puis importez."
      width={720}
    >
      <ImportFlow onClose={onClose} />
    </Modal>
  );
}

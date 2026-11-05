"use client";

import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { GrowBar } from "@/components/motion/grow-bar";
import { cn } from "@/lib/cn";
import type { ImportLineResult, ImportPreview, ImportPreviewRow } from "../crm.import.service";
import { previewImportAction, runImportBatchAction } from "../crm.actions";

const MAX_FILE_BYTES = 1_000_000;
const BATCH_SIZE = 10;

const STATUS_BADGE = {
  ready: { label: "Prête", tone: "success" },
  duplicate: { label: "Doublon", tone: "warn" },
  rejected: { label: "Refusée", tone: "danger" },
} as const;

const RESULT_LABEL: Record<ImportLineResult["status"], string> = {
  created: "Créée",
  already: "Déjà importée",
  duplicate: "Doublon",
  failed: "Échec",
};

function reportCsv(
  rows: readonly ImportPreviewRow[],
  results: ReadonlyMap<number, ImportLineResult>,
) {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const lines = rows
    .filter((row) => row.status !== "ready" || results.get(row.line)?.status === "failed")
    .map((row) => {
      const result = results.get(row.line);
      const reason = [...row.reasons, result?.message].filter(Boolean).join(" ");
      return [String(row.line), row.name, row.status, reason].map(escape).join(";");
    });
  return `﻿Ligne;Nom;Statut;Motif\n${lines.join("\n")}\n`;
}

function ImportFlow({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ReadonlyMap<number, ImportLineResult>>(new Map());
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();

  function onFile(file: File | undefined) {
    setPreview(null);
    setResults(new Map());
    setStopped(null);
    setError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("Fichier trop lourd : 1 Mo au maximum, découpez-le.");
      return;
    }
    setFileName(file.name);
    startPreview(async () => {
      const text = await file.text();
      setCsv(text);
      const result = await previewImportAction(text);
      if (result.status === "error") setError(result.message);
      else setPreview(result.preview);
    });
  }

  const ready = preview?.rows.filter((row) => row.status === "ready") ?? [];
  const remaining = ready.filter((row) => {
    const status = results.get(row.line)?.status;
    return status !== "created" && status !== "already" && status !== "duplicate";
  });
  const done = ready.length - remaining.length;
  const finished = preview !== null && results.size > 0 && remaining.length === 0;

  async function runImport() {
    if (!preview || !csv) return;
    setRunning(true);
    setStopped(null);
    const collected = new Map(results);
    try {
      // Lots courts : Twenty limite à 100 requêtes par minute, et chaque lot se reprend sans doublon.
      for (let index = 0; index < remaining.length; index += BATCH_SIZE) {
        const lines = remaining.slice(index, index + BATCH_SIZE).map((row) => row.line);
        const result = await runImportBatchAction({ importId: preview.importId, csv, lines });
        if (result.status === "error") {
          setStopped(result.message);
          return;
        }
        for (const line of result.results) collected.set(line.line, line);
        setResults(new Map(collected));
        if (result.stoppedBy) {
          setStopped(result.stoppedBy);
          return;
        }
      }
      const created = [...collected.values()].filter((row) => row.status === "created").length;
      toast({
        message: `${created} client${created > 1 ? "s" : ""} importé${created > 1 ? "s" : ""}.`,
      });
    } finally {
      setRunning(false);
    }
  }

  function downloadReport() {
    if (!preview) return;
    const url = URL.createObjectURL(
      new Blob([reportCsv(preview.rows, results)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "rapport-import-clients.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <ModalRow className="flex flex-col gap-2">
        <p className="text-sm text-muted">
          CSV à séparateur « ; » ou « , », une ligne par client. Colonnes reconnues : Nom, Domaine,
          Activité, Statut, Origine, SIREN, Téléphone, Adresse, Code postal, Ville, Pays, Tags,
          Notes, Prénom, Nom contact, E-mail, Téléphone contact, Poste.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            aria-label="Fichier CSV à importer"
            className="sr-only"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
          <Button icon="download" loading={previewing} onClick={() => input.current?.click()}>
            Choisir un fichier
          </Button>
          {fileName ? <span className="truncate text-sm text-text">{fileName}</span> : null}
        </div>
      </ModalRow>
      {error ? (
        <ModalRow>
          <Alert tone="danger">{error}</Alert>
        </ModalRow>
      ) : null}
      {preview ? (
        <>
          <ModalRow className="flex flex-wrap items-center gap-2">
            <Badge tone="success">
              {preview.ready} {preview.ready > 1 ? "prêtes" : "prête"}
            </Badge>
            <Badge tone="warn">
              {preview.duplicates} {preview.duplicates > 1 ? "doublons" : "doublon"}
            </Badge>
            <Badge tone="danger">
              {preview.rejected} {preview.rejected > 1 ? "refusées" : "refusée"}
            </Badge>
            {preview.ignoredColumns.length > 0 ? (
              <span className="text-xs text-muted">
                Colonnes ignorées : {preview.ignoredColumns.join(", ")}
              </span>
            ) : null}
          </ModalRow>
          <ModalRow>
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                <caption className="sr-only">Aperçu de l&apos;import, ligne par ligne</caption>
                <thead>
                  <tr className="sticky top-0 border-b border-border bg-surface">
                    <th scope="col" className="w-14 px-3 py-2 font-mono text-table-head text-muted">
                      LIGNE
                    </th>
                    <th scope="col" className="px-3 py-2 font-mono text-table-head text-muted">
                      CLIENT
                    </th>
                    <th scope="col" className="w-28 px-3 py-2 font-mono text-table-head text-muted">
                      ÉTAT
                    </th>
                    <th scope="col" className="px-3 py-2 font-mono text-table-head text-muted">
                      MOTIF
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => {
                    const result = results.get(row.line);
                    const badge = STATUS_BADGE[row.status];
                    return (
                      <tr key={row.line} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2 font-mono text-xs text-muted">{row.line}</td>
                        <td className="px-3 py-2">
                          <span className="block truncate text-text">{row.name || "—"}</span>
                          {row.contact || row.email ? (
                            <span className="block truncate text-xs text-muted">
                              {[row.contact, row.email].filter(Boolean).join(" · ")}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          {result ? (
                            <Badge
                              tone={
                                result.status === "created" || result.status === "already"
                                  ? "success"
                                  : result.status === "duplicate"
                                    ? "warn"
                                    : "danger"
                              }
                            >
                              {RESULT_LABEL[result.status]}
                            </Badge>
                          ) : (
                            <Badge tone={badge.tone}>{badge.label}</Badge>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-xs",
                            row.status === "ready" && !result?.message ? "text-muted" : "text-text",
                          )}
                        >
                          {[...row.reasons, result?.message].filter(Boolean).join(" ") || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ModalRow>
          {running || done > 0 ? (
            <ModalRow className="flex flex-col gap-1">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={ready.length}
                aria-valuenow={done}
                aria-label="Avancement de l'import"
                className="h-2 overflow-hidden rounded-full bg-surface-raised"
              >
                <GrowBar
                  value={ready.length ? done / ready.length : 0}
                  className="h-full bg-accent"
                />
              </div>
              <p aria-live="polite" className="text-xs text-muted">
                {done} sur {ready.length} {ready.length > 1 ? "lignes traitées" : "ligne traitée"}
              </p>
            </ModalRow>
          ) : null}
          {stopped ? (
            <ModalRow>
              <Alert tone="warn">
                Import interrompu : {stopped} Ce qui a été créé est conservé, la reprise ne crée pas
                de doublon.
              </Alert>
            </ModalRow>
          ) : null}
          <ModalRow className="flex flex-wrap justify-end gap-3">
            {preview.duplicates + preview.rejected > 0 || results.size > 0 ? (
              <Button icon="download" onClick={downloadReport}>
                Rapport des refus
              </Button>
            ) : null}
            {finished ? (
              <Button variant="accent" onClick={onClose}>
                Terminer
              </Button>
            ) : (
              <Button
                variant="accent"
                loading={running}
                disabled={remaining.length === 0}
                onClick={() => void runImport()}
              >
                {stopped
                  ? "Reprendre l'import"
                  : `Importer ${remaining.length} ${remaining.length > 1 ? "fiches" : "fiche"}`}
              </Button>
            )}
          </ModalRow>
        </>
      ) : null}
    </>
  );
}

/** « Importer » de l'écran 07 : aperçu réel, puis lots repris sans doublon. */
export function ImportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Importer</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Importer des clients" width={760}>
        <ImportFlow onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

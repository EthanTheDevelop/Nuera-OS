"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { Alert } from "@/components/ui/feedback";
import { Field, FormAlert, fieldDescription, Input, Select, Textarea } from "@/components/ui/form";
import { DurationField, MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Tile } from "@/components/ui/tile";
import { fieldError, IDLE_ACTION_STATE, submittedValue } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import {
  CATALOG_ITEM_KIND_LABELS,
  CATALOG_ITEM_KINDS,
  type CatalogItemKind,
} from "@/lib/domain-enums";
import { formatDays, formatPercent } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { saveQuoteAction } from "../quote.actions";
import { computeAmounts, computeTotals } from "../quote.calc";
import { addDays, RECURRING_UNIT_LABEL } from "../quote.rules";

export interface EditorCatalogItem {
  id: string;
  kind: CatalogItemKind;
  name: string;
  priceCents: number;
  estimatedCostCents: number;
  estimatedMinutes: number;
  scope: string | null;
  exclusions: string | null;
  conditions: string | null;
  validityDays: number | null;
  depositPercent: number | null;
}

export interface EditorLine {
  key: string;
  catalogItemId: string | null;
  label: string;
  unitLabel: string;
  quantity: number;
  unitPriceCents: number;
  estimatedCostCents: number;
  estimatedMinutes: number;
  recurring: boolean;
}

export interface QuoteEditorProps {
  quoteId: string;
  number: string;
  companyName: string;
  title: string;
  issuedByNote: string;
  versionNumber: number;
  /** La version courante est figée : enregistrer un changement crée la version suivante. */
  versionFrozen: boolean;
  scope: string;
  exclusions: string;
  conditions: string;
  validUntil: string;
  depositPercent: number | null;
  taxPercent: number;
  lines: readonly EditorLine[];
  catalog: readonly EditorCatalogItem[];
  today: string;
}

let lineKeyCounter = 0;
function nextLineKey() {
  lineKeyCounter += 1;
  return `new-${lineKeyCounter}`;
}

function LineEditor({
  line,
  onChange,
  onRemove,
  index,
}: {
  line: EditorLine;
  onChange: (patch: Partial<EditorLine>) => void;
  onRemove: () => void;
  index: number;
}) {
  const baseId = useId();
  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-table-head text-muted">Ligne {index + 1}</span>
          {line.recurring ? <Badge tone="accent">Récurrent, hors total</Badge> : null}
        </div>
        <CompactButton variant="quiet" onClick={onRemove}>
          Retirer
        </CompactButton>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_90px]">
        <Field id={`${baseId}-label`} label="Prestation">
          <Input
            id={`${baseId}-label`}
            value={line.label}
            onChange={(event) => onChange({ label: event.target.value })}
            required
          />
        </Field>
        <Field id={`${baseId}-unit`} label="Unité">
          <Input
            id={`${baseId}-unit`}
            value={line.unitLabel}
            placeholder="12 j"
            onChange={(event) => onChange({ unitLabel: event.target.value })}
          />
        </Field>
        <Field id={`${baseId}-qty`} label="Quantité">
          <Input
            id={`${baseId}-qty`}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            className="tabular text-right"
            value={line.quantity}
            onChange={(event) => onChange({ quantity: Number(event.target.value) })}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MoneyField
          id={`${baseId}-price`}
          name={`line-${line.key}-price`}
          label="Prix unitaire HT"
          defaultCents={line.unitPriceCents}
          onCentsChange={(cents) => onChange({ unitPriceCents: cents ?? 0 })}
        />
        <MoneyField
          id={`${baseId}-cost`}
          name={`line-${line.key}-cost`}
          label="Coût estimé"
          defaultCents={line.estimatedCostCents}
          onCentsChange={(cents) => onChange({ estimatedCostCents: cents ?? 0 })}
        />
        <DurationField
          id={`${baseId}-minutes`}
          name={`line-${line.key}-minutes`}
          label="Temps estimé"
          defaultMinutes={line.estimatedMinutes}
          onMinutesChange={(minutes) => onChange({ estimatedMinutes: minutes ?? 0 })}
        />
      </div>
    </li>
  );
}

/**
 * Éditeur d'un devis (non dessiné dans Figma, qui montre le résultat) : lignes depuis le catalogue,
 * quantités, périmètre, exclusions, conditions, validité, acompte. La colonne de droite reprend le
 * récapitulatif de l'écran 09. Elle n'est qu'un aperçu : le serveur recalcule tout à l'enregistrement.
 */
export function QuoteEditor(props: QuoteEditorProps) {
  const [state, action] = useActionState(saveQuoteAction, IDLE_ACTION_STATE);
  const [lines, setLines] = useState<EditorLine[]>(() => [...props.lines]);
  const [title, setTitle] = useState(props.title);
  const [scope, setScope] = useState(props.scope);
  const [exclusions, setExclusions] = useState(props.exclusions);
  const [conditions, setConditions] = useState(props.conditions);
  const [validUntil, setValidUntil] = useState(props.validUntil);
  const [deposit, setDeposit] = useState(
    props.depositPercent === null ? "" : String(props.depositPercent),
  );
  const [tax, setTax] = useState(String(props.taxPercent));
  const [catalogChoice, setCatalogChoice] = useState("");

  const totals = useMemo(() => computeTotals(lines), [lines]);
  const amounts = computeAmounts({
    totalCents: totals.totalCents,
    estimatedCostCents: totals.estimatedCostCents,
    taxPercent: Number(tax) || 0,
    depositPercent: Number(deposit) || 0,
  });

  const updateLine = (key: string, patch: Partial<EditorLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  function addFromCatalog(id: string) {
    const item = props.catalog.find((candidate) => candidate.id === id);
    if (!item) return;
    const recurring = item.kind === "recurring";
    setLines((current) => [
      ...current,
      {
        key: nextLineKey(),
        catalogItemId: item.id,
        label: item.name,
        unitLabel: recurring
          ? RECURRING_UNIT_LABEL
          : item.estimatedMinutes > 0
            ? formatDays(item.estimatedMinutes)
            : "",
        quantity: 1,
        unitPriceCents: item.priceCents,
        estimatedCostCents: item.estimatedCostCents,
        estimatedMinutes: item.estimatedMinutes,
        recurring,
      },
    ]);
    // Le catalogue propose ; rien de ce qui est déjà écrit n'est écrasé.
    if (!scope && item.scope) setScope(item.scope);
    if (!exclusions && item.exclusions) setExclusions(item.exclusions);
    if (!conditions && item.conditions) setConditions(item.conditions);
    if (!validUntil && item.validityDays) setValidUntil(addDays(props.today, item.validityDays));
    if (deposit === "" && item.depositPercent !== null) setDeposit(String(item.depositPercent));
    // « Ajouter » va se griser : le focus revient à la liste, pour enchaîner au clavier.
    document.getElementById("catalog-choice")?.focus();
    setCatalogChoice("");
  }

  function addFreeLine() {
    setLines((current) => [
      ...current,
      {
        key: nextLineKey(),
        catalogItemId: null,
        label: "",
        unitLabel: "",
        quantity: 1,
        unitPriceCents: 0,
        estimatedCostCents: 0,
        estimatedMinutes: 0,
        recurring: false,
      },
    ]);
  }

  const serialized = JSON.stringify(
    lines.map(({ catalogItemId, label, unitLabel, quantity, unitPriceCents, ...rest }) => ({
      catalogItemId,
      label,
      unitLabel,
      quantity,
      unitPriceCents,
      estimatedCostCents: rest.estimatedCostCents,
      estimatedMinutes: rest.estimatedMinutes,
    })),
  );

  const changeNoteError = fieldError(state, "changeNote");
  const validUntilError = fieldError(state, "validUntil");
  const titleError = fieldError(state, "title");
  const depositError = fieldError(state, "depositPercent");
  const taxError = fieldError(state, "taxPercent");

  return (
    <form
      action={action}
      className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1040px)_380px] 2xl:justify-center"
    >
      <input type="hidden" name="quoteId" value={props.quoteId} />
      <input type="hidden" name="lines" value={serialized} />

      <div className="flex min-w-0 flex-col gap-5">
        <FormAlert state={state} />
        {props.versionFrozen ? (
          <Alert tone="info">
            La version {props.versionNumber} a été envoyée, elle reste figée. Tout changement
            enregistré ici crée la version {props.versionNumber + 1}.
          </Alert>
        ) : null}

        <Tile className="gap-4 rounded-lg p-6">
          <Field id="title" label="Offre" error={titleError}>
            <Input
              id="title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              {...fieldDescription("title", { error: titleError })}
            />
          </Field>
          <Field id="issuedByNote" label="Émis par">
            <Input
              id="issuedByNote"
              name="issuedByNote"
              placeholder="Mention affichée sous l'offre, par exemple « Émis par Nuera Studio »"
              defaultValue={submittedValue(state, "issuedByNote") ?? props.issuedByNote}
            />
          </Field>
        </Tile>

        <Tile icon="devis" title="Lignes" className="gap-4 rounded-lg p-6">
          {lines.length > 0 ? (
            <ol className="flex flex-col gap-3">
              {lines.map((line, index) => (
                <LineEditor
                  key={line.key}
                  index={index}
                  line={line}
                  onChange={(patch) => updateLine(line.key, patch)}
                  onRemove={() =>
                    setLines((current) => current.filter((item) => item.key !== line.key))
                  }
                />
              ))}
            </ol>
          ) : (
            <p className="rounded-md bg-surface-raised px-4 py-3 text-sm text-muted">
              Ajoutez une prestation du catalogue, ou une ligne libre.
            </p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field
              id="catalog-choice"
              label="Ajouter depuis le catalogue"
              className="min-w-0 flex-1"
            >
              {/* En deux temps : au clavier, chaque flèche sur la liste fermée déclenche un changement. */}
              <Select
                id="catalog-choice"
                value={catalogChoice}
                onChange={(event) => setCatalogChoice(event.target.value)}
              >
                <option value="">Choisir une prestation</option>
                {CATALOG_ITEM_KINDS.map((kind) => {
                  const items = props.catalog.filter((item) => item.kind === kind);
                  if (items.length === 0) return null;
                  return (
                    <optgroup key={kind} label={CATALOG_ITEM_KIND_LABELS[kind]}>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {formatCents(item.priceCents)}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </Select>
            </Field>
            <div className="mb-1 flex flex-wrap gap-2">
              <CompactButton
                icon="plus"
                disabled={!catalogChoice}
                onClick={() => addFromCatalog(catalogChoice)}
              >
                Ajouter
              </CompactButton>
              <CompactButton variant="secondary" icon="plus" onClick={addFreeLine}>
                Ligne libre
              </CompactButton>
            </div>
          </div>
        </Tile>

        <Tile icon="book" title="Périmètre et conditions" className="gap-4 rounded-lg p-6">
          <Field id="scope" label="Périmètre" hint="Livrables et fonctionnalités prévus.">
            <Textarea
              id="scope"
              name="scope"
              rows={3}
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            />
          </Field>
          <Field id="exclusions" label="Exclusions">
            <Textarea
              id="exclusions"
              name="exclusions"
              rows={2}
              value={exclusions}
              onChange={(event) => setExclusions(event.target.value)}
            />
          </Field>
          <Field id="conditions" label="Conditions">
            <Textarea
              id="conditions"
              name="conditions"
              rows={2}
              value={conditions}
              onChange={(event) => setConditions(event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              id="validUntil"
              label="Valable jusqu'au"
              error={validUntilError}
              hint="Obligatoire pour envoyer."
            >
              <Input
                id="validUntil"
                name="validUntil"
                type="date"
                className="tabular"
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
                {...fieldDescription("validUntil", {
                  hint: "Obligatoire pour envoyer.",
                  error: validUntilError,
                })}
              />
            </Field>
            <Field id="depositPercent" label="Acompte, en %" error={depositError}>
              <Input
                id="depositPercent"
                name="depositPercent"
                inputMode="numeric"
                className="tabular text-right"
                value={deposit}
                onChange={(event) => setDeposit(event.target.value)}
                {...fieldDescription("depositPercent", { error: depositError })}
              />
            </Field>
            <Field id="taxPercent" label="TVA, en %" error={taxError}>
              <Input
                id="taxPercent"
                name="taxPercent"
                inputMode="numeric"
                className="tabular text-right"
                value={tax}
                onChange={(event) => setTax(event.target.value)}
                {...fieldDescription("taxPercent", { error: taxError })}
              />
            </Field>
          </div>
          {props.versionFrozen ? (
            <Field
              id="changeNote"
              label="Ce qui change par rapport à la version envoyée"
              error={changeNoteError}
            >
              <Input
                id="changeNote"
                name="changeNote"
                defaultValue={submittedValue(state, "changeNote") ?? ""}
                {...fieldDescription("changeNote", { error: changeNoteError })}
              />
            </Field>
          ) : null}
        </Tile>
      </div>

      <aside className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-7">
        <Tile className="gap-4 rounded-lg p-6">
          <h2 className="text-[17px] leading-tight font-semibold text-ink">
            {props.number} · {props.companyName}
          </h2>
          <dl className="flex flex-col gap-3 text-sm">
            <SummaryRow label="Total HT" value={formatCents(amounts.totalCents)} />
            <SummaryRow label={`TVA ${Number(tax) || 0} %`} value={formatCents(amounts.taxCents)} />
            <SummaryRow
              label={Number(deposit) ? `Acompte ${Number(deposit)} %` : "Acompte"}
              value={Number(deposit) ? formatCents(amounts.depositCents) : "Sans acompte"}
            />
            {totals.recurringCents > 0 ? (
              <SummaryRow
                label="Récurrent, hors total"
                value={formatCents(totals.recurringCents)}
              />
            ) : null}
          </dl>
          <section
            aria-label="Rentabilité estimée"
            className={cn(
              "flex flex-col gap-2 rounded-md p-4",
              amounts.marginPercent === null
                ? "bg-surface-raised"
                : amounts.marginPercent < 0
                  ? "bg-danger-pale"
                  : "bg-success-pale",
            )}
          >
            <div
              className={cn(
                "flex items-center justify-between gap-3 text-[13px] font-semibold",
                amounts.marginPercent === null
                  ? "text-muted"
                  : amounts.marginPercent < 0
                    ? "text-danger"
                    : "text-success",
              )}
            >
              <h3>Rentabilité estimée</h3>
              <p className="tabular">
                {amounts.marginPercent === null ? "—" : formatPercent(amounts.marginPercent)}
              </p>
            </div>
            <p className="text-xs text-text">
              {formatDays(totals.estimatedMinutes)} estimés · coût interne ≈{" "}
              {formatCents(totals.estimatedCostCents)}
            </p>
          </section>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/devis/${props.quoteId}`}>Annuler</ButtonLink>
            <SubmitButton>Enregistrer</SubmitButton>
          </div>
        </Tile>
      </aside>
    </form>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular font-semibold text-ink">{value}</dd>
    </div>
  );
}

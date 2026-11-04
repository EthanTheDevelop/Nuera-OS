"use client";

import { useState, type ComponentProps, type InputHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { fieldError, submittedValue } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { formatMinutes } from "@/lib/format";
import { parseEurosToCents } from "@/lib/money";
import { Button } from "./button";
import { Field, fieldDescription, Input, type FormFieldProps } from "./form";
import { parseDurationToMinutes } from "./form-parsers";

const EURO_INPUT_FORMAT = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCentsForInput = (cents: number) => EURO_INPUT_FORMAT.format(cents / 100);

/**
 * Bouton d'envoi d'un formulaire : passe seul en chargement pendant la Server Action.
 * Doit être rendu à l'intérieur du `<form>`.
 */
export function SubmitButton({
  variant = "accent",
  children,
  ...props
}: ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} loading={pending} {...props}>
      {children}
    </Button>
  );
}

type ParsedInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "name" | "defaultValue" | "value" | "onChange"
>;

function ParsedField({
  name,
  label,
  hint,
  state,
  id,
  fieldClassName,
  initial,
  parse,
  format,
  unit,
  invalidMessage,
  onValueChange,
  className,
  ...props
}: FormFieldProps &
  ParsedInputProps & {
    initial: number | null;
    parse: (input: string) => number | null;
    format: (value: number) => string;
    unit: string;
    invalidMessage: string;
    onValueChange?: (value: number | null) => void;
  }) {
  const controlId = id ?? name;
  const returned = state ? submittedValue(state, name) : undefined;
  const start = returned !== undefined && returned !== "" ? Number(returned) : initial;
  const [text, setText] = useState(start === null ? "" : format(start));
  const parsed = parse(text);
  const invalid = text.trim() !== "" && parsed === null;
  const error =
    (state ? fieldError(state, name) : undefined) ?? (invalid ? invalidMessage : undefined);

  return (
    <Field id={controlId} label={label} hint={hint} error={error} className={fieldClassName}>
      {/* La valeur envoyée est l'unité du domaine (centimes, minutes), jamais le texte saisi. */}
      <input type="hidden" name={name} value={parsed ?? ""} />
      <span className="relative block">
        <Input
          id={controlId}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onValueChange?.(parse(event.target.value));
          }}
          onBlur={() => {
            if (parsed !== null) setText(format(parsed));
          }}
          className={cn("tabular pr-11 text-right", className)}
          {...fieldDescription(controlId, { hint, error })}
          {...props}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-muted"
        >
          {unit}
        </span>
      </span>
    </Field>
  );
}

/**
 * Montant en euros. L'utilisateur saisit « 1 234,50 » ; le formulaire envoie `name=123450`
 * (centimes HT, contrat de domaine §2). `defaultCents` : valeur initiale, en centimes.
 */
export function MoneyField({
  defaultCents = null,
  onCentsChange,
  ...props
}: FormFieldProps &
  ParsedInputProps & {
    defaultCents?: number | null;
    onCentsChange?: (cents: number | null) => void;
  }) {
  return (
    <ParsedField
      initial={defaultCents}
      parse={parseEurosToCents}
      format={formatCentsForInput}
      unit="€"
      invalidMessage="Saisissez un montant, par exemple 1 234,50."
      onValueChange={onCentsChange}
      {...props}
    />
  );
}

/**
 * Durée. L'utilisateur saisit « 1h30 », « 90 », « 0,5 j » ; le formulaire envoie `name=90`
 * (minutes, contrat de domaine §2). `defaultMinutes` : valeur initiale, en minutes.
 */
export function DurationField({
  defaultMinutes = null,
  onMinutesChange,
  minutesPerDay,
  ...props
}: FormFieldProps &
  ParsedInputProps & {
    defaultMinutes?: number | null;
    onMinutesChange?: (minutes: number | null) => void;
    /** Conversion d'une saisie en journées. Défaut : 7 h. */
    minutesPerDay?: number;
  }) {
  return (
    <ParsedField
      initial={defaultMinutes}
      parse={(input) => parseDurationToMinutes(input, minutesPerDay)}
      format={formatMinutes}
      unit=""
      invalidMessage="Saisissez une durée, par exemple 1h30, 90 ou 0,5 j."
      onValueChange={onMinutesChange}
      {...props}
    />
  );
}

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { fieldError, submittedValue, type ActionState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";

/**
 * Champ (Figma 68:1278, 141:7383) : bordure `--border`, rayon 12, hauteur tactile 44.
 * Au focus, le contour passe à 1,5 px sombre et l'aide s'efface en 150 ms (motion.md §2.7).
 */
const CONTROL = cn(
  "block w-full rounded-md border border-border bg-surface text-field text-text outline-none",
  "transition-[border-color,box-shadow] duration-(--dur-fast) ease-out",
  "placeholder:text-muted placeholder:transition-opacity placeholder:duration-(--dur-fast) focus:placeholder:opacity-0",
  "focus:border-text focus:shadow-[inset_0_0_0_0.5px_var(--text)]",
  "aria-invalid:border-danger aria-invalid:focus:shadow-[inset_0_0_0_0.5px_var(--danger)]",
  "disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-muted",
);

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, "h-11 px-4", className)} {...props} />;
}

export function Textarea({
  className,
  rows = 4,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea rows={rows} className={cn(CONTROL, "resize-y px-4 py-3", className)} {...props} />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select className={cn(CONTROL, "h-11 appearance-none pr-10 pl-4", className)} {...props}>
        {children}
      </select>
      <Icon
        name="chevron"
        size={14}
        className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 rotate-90 text-muted"
      />
    </span>
  );
}

/** Sélecteur de date natif : calendrier du système, valeur `AAAA-MM-JJ`. */
export function DateInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <Input type="date" className={cn("tabular", className)} {...props} />;
}

/** Case à cocher, libellé inclus : toute la ligne est cliquable, 44 px de haut. */
export function Checkbox({
  label,
  description,
  className,
  id,
  ...props
}: {
  label: ReactNode;
  description?: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 py-3", className)}>
      <span className="relative mt-px flex size-[18px] shrink-0">
        <input
          id={id}
          type="checkbox"
          className="peer size-[18px] cursor-pointer appearance-none rounded-[5px] border border-border bg-surface transition-colors duration-(--dur-fast) checked:border-accent checked:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50"
          {...props}
        />
        <Icon
          name="check"
          size={14}
          strokeWidth={2.6}
          className="pointer-events-none absolute top-0.5 left-0.5 text-on-accent opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-text">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

/** Identifiants `aria-describedby` / `aria-invalid` cohérents pour un champ. */
export function fieldDescription(
  id: string,
  { hint, error }: { hint?: ReactNode; error?: string },
) {
  const ids = [hint && !error ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return {
    "aria-describedby": ids.length ? ids.join(" ") : undefined,
    "aria-invalid": error ? true : undefined,
  } as const;
}

/** Libellé + contrôle + aide + erreur, accessibles (associer `fieldDescription` au contrôle). */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <label htmlFor={id} className="block text-field-label text-text">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Champ branché sur l'état d'une Server Action : erreur, valeur renvoyée, attributs ARIA. */
export interface FormFieldProps {
  /** Nom du champ, identique à la clé du schéma Zod. */
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  /** État retourné par `useActionState`. */
  state?: ActionState;
  /** Identifiant du contrôle. Défaut : `name`. */
  id?: string;
  fieldClassName?: string;
}

function fieldBindings({ name, id, hint, state }: FormFieldProps) {
  const controlId = id ?? name;
  const error = state ? fieldError(state, name) : undefined;
  const value = state ? submittedValue(state, name) : undefined;
  return {
    controlId,
    error,
    value,
    aria: fieldDescription(controlId, { hint, error }),
  };
}

/**
 * Raccourcis `TextField`, `TextareaField`, `SelectField`, `DateField` : à utiliser avec
 * `useActionState` (voir `toActionErrorState` dans `src/server/actions.ts`). Après une erreur, la
 * saisie est rétablie.
 *
 * ```tsx
 * const [state, action] = useActionState(saveAction, IDLE_ACTION_STATE);
 * <form action={action}>
 *   <FormAlert state={state} />
 *   <TextField state={state} name="name" label="Nom" required />
 *   <SubmitButton>Enregistrer</SubmitButton>
 * </form>
 * ```
 */
export function TextField({
  name,
  label,
  hint,
  state,
  id,
  fieldClassName,
  defaultValue,
  ...props
}: FormFieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "id">) {
  const { controlId, error, value, aria } = fieldBindings({ name, label, hint, state, id });
  return (
    <Field id={controlId} label={label} hint={hint} error={error} className={fieldClassName}>
      <Input
        key={value}
        id={controlId}
        name={name}
        defaultValue={value ?? defaultValue}
        {...aria}
        {...props}
      />
    </Field>
  );
}

export function TextareaField({
  name,
  label,
  hint,
  state,
  id,
  fieldClassName,
  defaultValue,
  ...props
}: FormFieldProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "name" | "id">) {
  const { controlId, error, value, aria } = fieldBindings({ name, label, hint, state, id });
  return (
    <Field id={controlId} label={label} hint={hint} error={error} className={fieldClassName}>
      <Textarea
        key={value}
        id={controlId}
        name={name}
        defaultValue={value ?? defaultValue}
        {...aria}
        {...props}
      />
    </Field>
  );
}

export function SelectField({
  name,
  label,
  hint,
  state,
  id,
  fieldClassName,
  defaultValue,
  children,
  ...props
}: FormFieldProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, "name" | "id">) {
  const { controlId, error, value, aria } = fieldBindings({ name, label, hint, state, id });
  return (
    <Field id={controlId} label={label} hint={hint} error={error} className={fieldClassName}>
      <Select
        key={value}
        id={controlId}
        name={name}
        defaultValue={value ?? defaultValue}
        {...aria}
        {...props}
      >
        {children}
      </Select>
    </Field>
  );
}

export function DateField(
  props: FormFieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "id" | "type">,
) {
  return <TextField type="date" {...props} />;
}

/** Message global d'une Server Action (erreur ou succès). Rien à l'état initial. */
export function FormAlert({ state, className }: { state: ActionState; className?: string }) {
  if (state.status === "idle") return null;
  const isError = state.status === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "rounded-md px-4 py-3 text-sm",
        isError ? "bg-danger-pale text-danger" : "bg-success-pale text-success",
        className,
      )}
    >
      {state.message}
    </div>
  );
}

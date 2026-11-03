import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "block h-9 w-full rounded-md border border-line bg-surface px-3 text-ink",
        "placeholder:text-ink-subtle focus-visible:outline-2 focus-visible:outline-accent",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

/** Identifiants `aria-describedby` / `aria-invalid` cohérents pour un champ. */
export function fieldDescription(
  id: string,
  { hint, error }: { hint?: ReactNode; error?: string },
) {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
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
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
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

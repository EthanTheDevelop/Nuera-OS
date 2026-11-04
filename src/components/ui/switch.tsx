"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Interrupteur (Figma 88:2439), 36 × 20, zone cliquable 44. Actif `--accent` (`chatgpt` sur la
 * carte de l'écran 05), inactif gris. Rôle `switch`, contrôlé ou non. Dans un formulaire, `name`
 * envoie `on` quand il est actif, comme une case à cocher.
 */
export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  label,
  description,
  hideLabel = false,
  tone = "accent",
  name,
  disabled = false,
  className,
}: {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  /** Masque le libellé à l'écran : il reste annoncé. */
  hideLabel?: boolean;
  tone?: "accent" | "chatgpt";
  name?: string;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const [internal, setInternal] = useState(defaultChecked);
  const on = checked ?? internal;

  function toggle() {
    if (disabled) return;
    const next = !on;
    setInternal(next);
    onCheckedChange?.(next);
  }

  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className={cn("min-w-0", hideLabel && "sr-only")}>
        <span id={`${id}-label`} className="block text-sm font-medium text-text">
          {label}
        </span>
        {description ? (
          <span id={`${id}-description`} className="mt-0.5 block text-xs text-muted">
            {description}
          </span>
        ) : null}
      </div>
      {name && on ? <input type="hidden" name={name} value="on" /> : null}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={disabled}
        onClick={toggle}
        className={cn(
          "hit-44 relative h-5 w-9 shrink-0 rounded-full transition-colors duration-(--dur-fast) ease-out",
          "disabled:cursor-not-allowed disabled:opacity-50",
          on ? (tone === "chatgpt" ? "bg-chatgpt" : "bg-accent") : "bg-border",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-paper transition-transform duration-(--dur-fast) ease-out",
            on && "translate-x-4",
          )}
        />
      </button>
    </div>
  );
}

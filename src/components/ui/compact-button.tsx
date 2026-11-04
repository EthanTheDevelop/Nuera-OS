import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./button";
import { Icon, type IconName } from "./icon";

export type CompactVariant = "primary" | "secondary" | "quiet";

const VARIANTS: Record<CompactVariant, string> = {
  primary: "bg-accent pr-3.5 pl-3 text-on-accent hover:brightness-95 active:brightness-90",
  secondary:
    "border border-border bg-surface pr-3.5 pl-3 text-ink hover:bg-surface-raised active:brightness-95",
  quiet: "text-accent hover:underline hover:underline-offset-4",
};

function compactClasses(variant: CompactVariant, className?: string) {
  return cn(
    "hit-44 inline-flex h-9 items-center gap-1.5 rounded-md text-compact-button whitespace-nowrap",
    "transition-[filter,background-color] duration-(--dur-fast) ease-out",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress aria-busy:opacity-100",
    VARIANTS[variant],
    className,
  );
}

/**
 * Bouton compact (Figma 168:6952), celui de l'espace client : hauteur 36, zone cliquable 44.
 * Règle Figma : une seule action `primary` par carte. Compatible serveur.
 */
export function CompactButton({
  variant = "primary",
  icon,
  loading = false,
  disabled,
  className,
  type = "button",
  children,
  ...props
}: {
  variant?: CompactVariant;
  icon?: IconName;
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={compactClasses(variant, className)}
      {...props}
    >
      {loading ? <Spinner size={16} /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function CompactLink({
  variant = "primary",
  icon,
  className,
  children,
  ...props
}: { variant?: CompactVariant; icon?: IconName } & ComponentProps<typeof Link>) {
  return (
    <Link className={compactClasses(variant, className)} {...props}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </Link>
  );
}

import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icon";

export type ButtonVariant = "default" | "accent" | "on-dark";

interface ButtonLook {
  /** `default` : face papier. `accent` : action principale, à droite. `on-dark` : section sombre. */
  variant?: ButtonVariant;
  icon?: IconName;
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("anim-spin shrink-0", className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.4" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ButtonInner({
  icon,
  loading,
  children,
}: {
  icon?: IconName;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <span aria-hidden="true" className="nu-btn-edge" />
      <span className="nu-btn-face">
        {loading ? <Spinner /> : icon ? <Icon name={icon} size={16} strokeWidth={2.2} /> : null}
        {children}
      </span>
    </>
  );
}

/**
 * Bouton 3D du Design System (Figma 7:117). Hauteur 54 px, cible tactile comprise.
 * `loading` garde le libellé, bloque l'action et annonce l'attente. Compatible serveur.
 */
export function Button({
  variant = "default",
  icon,
  loading = false,
  disabled,
  className,
  type = "button",
  children,
  ...props
}: ButtonLook & { loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      data-variant={variant}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn("nu-btn", className)}
      {...props}
    >
      <ButtonInner icon={icon} loading={loading}>
        {children}
      </ButtonInner>
    </button>
  );
}

/** Même dessin qu'un `Button`, pour une vraie navigation. */
export function ButtonLink({
  variant = "default",
  icon,
  className,
  children,
  ...props
}: ButtonLook & ComponentProps<typeof Link>) {
  return (
    <Link data-variant={variant} className={cn("nu-btn", className)} {...props}>
      <ButtonInner icon={icon}>{children}</ButtonInner>
    </Link>
  );
}

/** Même dessin, vers un outil externe (Coolify, Indy, Uptime Kuma…). */
export function ButtonExternalLink({
  variant = "default",
  icon,
  className,
  children,
  ...props
}: ButtonLook & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      target="_blank"
      rel="noreferrer noopener"
      data-variant={variant}
      className={cn("nu-btn", className)}
      {...props}
    >
      <ButtonInner icon={icon}>{children}</ButtonInner>
    </a>
  );
}

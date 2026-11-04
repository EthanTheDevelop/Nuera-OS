import type { ReactNode } from "react";
import { Logo } from "@/components/layout/logo";

/** Fond de l'écran 15 : `--near-black` plein écran, sans barre latérale. */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-near-black px-4 py-8">
      {children}
    </main>
  );
}

/**
 * Carte de connexion (Figma 88:3061) : 440 de large, rayon 20, `padding 24`, gap 20.
 * Logo papier dans un cartouche sombre 200 × 52, titre 600 24. Le papier reste blanc en thème sombre
 * comme en clair : c'est `--bg`, et la carte suit le thème.
 */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="anim-content flex w-full max-w-[440px] flex-col gap-5 rounded-lg bg-surface p-6 shadow-soft">
      <div className="w-fit rounded-md bg-near-black px-4 py-3">
        <Logo />
      </div>
      <h1 className="text-[24px] leading-[1.25] font-semibold text-ink">{title}</h1>
      {description ? <p className="-mt-1 text-sm text-muted">{description}</p> : null}
      {children}
    </div>
  );
}

import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";
import { Icon } from "@/components/ui/icon";
import { SignOutButton } from "@/modules/portal/components/sign-out-button";

export const metadata: Metadata = {
  title: "Accès retiré",
  robots: { index: false, follow: false },
};

/** Adhésion révoquée ou absente : rien de l'espace ne s'affiche, on dit quoi faire. */
export default function PortalAccessRemovedPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <div className="anim-content flex w-full max-w-[480px] flex-col items-center gap-5 rounded-xl border border-border bg-surface p-8 text-center">
        <Logo variant="os-ink" width={168} />
        <Icon name="shield" size={28} className="mt-3 text-warn" />
        <h1 className="text-[28px] leading-[1.25] font-bold text-ink">
          Votre accès n&apos;est plus actif
        </h1>
        <p className="text-base leading-[1.45] text-muted">
          Cet espace n&apos;est plus ouvert pour votre compte. S&apos;il s&apos;agit d&apos;une
          erreur, écrivez-nous à{" "}
          <a href="mailto:bonjour@nuera.studio" className="underline-offset-4 hover:underline">
            bonjour@nuera.studio
          </a>
          .
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}

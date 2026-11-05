import type { Metadata } from "next";
import { Logo } from "@/components/layout/logo";
import { CompactLink } from "@/components/ui/compact-button";
import { Icon } from "@/components/ui/icon";

export const metadata: Metadata = {
  title: "Ce lien a expiré",
  robots: { index: false, follow: false },
};

/** Écran C9 : destination d'un lien expiré ou déjà utilisé. Publique, sans capsule. */
export default function PortalLinkExpiredPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <div className="anim-content flex w-full max-w-[480px] flex-col items-center gap-5 rounded-xl border border-border bg-surface p-8 text-center">
        <Logo variant="os-ink" width={168} />
        <Icon name="clock" size={28} className="mt-3 text-warn" />
        <h1 className="text-[28px] leading-[1.25] font-bold text-ink">Ce lien a expiré</h1>
        <p className="text-base leading-[1.45] text-muted">
          Pour votre sécurité, un lien de connexion ne sert qu&apos;une fois et n&apos;est valable
          que 24 heures. Demandez-en un nouveau : il arrive en quelques secondes.
        </p>
        <CompactLink icon="send" href="/espace/connexion">
          Recevoir un nouveau lien
        </CompactLink>
        <p className="text-sm text-muted">
          Votre session a pris fin ? Même chemin : un nouveau lien suffit.
        </p>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/layout/logo";
import { PortalLoginForm } from "@/modules/portal/components/login-form";
import { isInternalRole } from "@/server/auth/roles";
import { getCurrentActor } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Connexion à votre espace",
  robots: { index: false, follow: false },
};

const PROMISES = [
  "Une date de mise en ligne qui ne glisse pas en silence",
  "Vos validations écrites, rien ne se perd",
  "Les mêmes interlocuteurs, du début à la fin",
];

/**
 * Écran C2 : 620 + 820. La page est publique. Déjà connecté : le client va à son espace (un accès
 * révoqué y est refusé), l'équipe à l'agence.
 */
export default async function PortalLoginPage() {
  const actor = await getCurrentActor();
  if (actor) redirect(isInternalRole(actor.role) ? "/" : "/espace");

  return (
    <main className="grid min-h-dvh bg-bg lg:grid-cols-[620px_minmax(0,1fr)]">
      <div className="flex flex-col justify-between gap-10 bg-near-black p-8 lg:p-16">
        <Logo width={168} />
        <div className="flex flex-col gap-5">
          <p className="text-[32px] leading-[1.25] font-bold text-paper lg:text-[44px]">
            Votre projet, au même endroit.
          </p>
          <p className="text-lg font-normal text-accent-on-dark">
            Où en est votre site, ce qu&apos;on attend de vous, vos maquettes à valider, vos
            factures et nos échanges.
          </p>
          <ul className="flex flex-col gap-2">
            {PROMISES.map((promise) => (
              <li key={promise} className="flex items-center gap-2.5 text-sm text-paper">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-accent-on-dark"
                />
                {promise}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-center p-6 lg:p-10">
        <div className="anim-content flex w-full max-w-[400px] flex-col gap-5">
          <h1 className="text-[32px] leading-[1.25] font-bold text-ink">
            Connexion à votre espace
          </h1>
          <p className="text-sm text-muted">
            Entrez l&apos;adresse e-mail que vous nous avez donnée. Nous vous envoyons un lien de
            connexion, sans mot de passe.
          </p>
          <PortalLoginForm />
          <p className="text-sm text-muted">
            Un souci ? Écrivez-nous :{" "}
            <a href="mailto:bonjour@nuera.studio" className="underline-offset-4 hover:underline">
              bonjour@nuera.studio
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}

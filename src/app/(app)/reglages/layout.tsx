import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/modules/platform/components/settings-tabs";
import { canAny, type Permission } from "@/server/auth/permissions";
import { requireInternalActor } from "@/server/auth/session";

export const metadata: Metadata = { title: "Réglages" };

const TABS: readonly { href: string; label: string; any: readonly Permission[] }[] = [
  { href: "/reglages/agence", label: "Agence", any: ["integrations:read"] },
  { href: "/reglages/associes", label: "Direction", any: ["team:read"] },
  { href: "/reglages/connexions", label: "Connexions", any: ["integrations:read"] },
  { href: "/reglages/modeles", label: "Modèles de messages", any: ["knowledge:read"] },
  { href: "/reglages/espace-client", label: "Espace client", any: ["integrations:read"] },
];

/** Figma ne dessine que Connexions : les autres onglets gardent le même cadre. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const actor = await requireInternalActor();
  const tabs = TABS.filter((tab) => canAny(actor, tab.any));
  return (
    <>
      <PageHeader
        title="Réglages"
        subtitle="Les outils branchés à Nuera OS. Tout tourne sur notre serveur, sauf ce que la loi impose (facturation, paiement) et ChatGPT."
      >
        <SettingsTabs tabs={tabs.map(({ href, label }) => ({ href, label }))} />
      </PageHeader>
      {children}
    </>
  );
}

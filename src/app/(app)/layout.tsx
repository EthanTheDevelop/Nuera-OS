import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ProfileMenu } from "@/components/layout/profile-menu";
import { Sidebar } from "@/components/layout/sidebar";
import { PageBuild } from "@/components/motion/page-build";
import { visibleNavigation } from "@/config/navigation";
import { can, canAny } from "@/server/auth/permissions";
import { ROLE_LABELS } from "@/server/auth/roles";
import { requireInternalActor } from "@/server/auth/session";

/**
 * Zone de l'agence : barre latérale + contenu. Un `client` part vers `/espace`.
 *
 * Le layout vérifie la session, MAIS chaque page et chaque service doivent revérifier :
 * un layout n'est pas réexécuté à chaque navigation côté client.
 *
 * À brancher par les lots concernés, sans rien changer aux composants : `counters` (Messages,
 * Support), `people` et `detail` (module Équipe), `notifications` et `chatgptLabel` (Plateforme),
 * `search` (recherche globale).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireInternalActor();
  const sections = visibleNavigation((permissions) => canAny(actor, permissions));
  const roleLabel = ROLE_LABELS[actor.role];

  return (
    <AppShell
      navigation={sections.flatMap((section) =>
        section.items.map(({ key, label, href, icon }) => ({ id: key, label, href, icon })),
      )}
      sidebar={
        <Sidebar
          sections={sections}
          userBlock={
            <ProfileMenu
              user={{ name: actor.name, email: actor.email, roleLabel }}
              title={actor.name}
              detail={`Nuera Studio · ${roleLabel.toLocaleLowerCase("fr-FR")}`}
              canManageAgency={can(actor, "integrations:read")}
            />
          }
        />
      }
    >
      <PageBuild>{children}</PageBuild>
    </AppShell>
  );
}

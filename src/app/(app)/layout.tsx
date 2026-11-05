import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ProfileMenu } from "@/components/layout/profile-menu";
import { Sidebar } from "@/components/layout/sidebar";
import { PageBuild } from "@/components/motion/page-build";
import { visibleNavigation } from "@/config/navigation";
import { saveThemeAction } from "@/modules/admin/admin.actions";
import { globalSearchAction } from "@/modules/dashboard/dashboard.actions";
import { AppearanceSync } from "@/modules/platform/components/appearance-sync";
import { getShellDataFor } from "@/modules/platform/shell.service";
import { can, canAny } from "@/server/auth/permissions";
import { ROLE_LABELS } from "@/server/auth/roles";
import { requireInternalActor } from "@/server/auth/session";

/**
 * Zone de l'agence : barre latérale + contenu. Un `client` part vers `/espace`.
 *
 * Le layout vérifie la session, MAIS chaque page et chaque service doivent revérifier :
 * un layout n'est pas réexécuté à chaque navigation côté client. La double authentification se
 * contrôle dans les pages (`getServiceContext`) : `/profil` reste ouvert à qui doit s'enrôler.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireInternalActor({ allowTwoFactorEnrolment: true });
  const sections = visibleNavigation((permissions) => canAny(actor, permissions));
  const roleLabel = ROLE_LABELS[actor.role];
  // Compteurs et notifications : une panne ne fait jamais tomber la coque (`getShellData`).
  const shell = await getShellDataFor(actor);

  return (
    <AppShell
      navigation={sections.flatMap((section) =>
        section.items.map(({ key, label, href, icon }) => ({ id: key, label, href, icon })),
      )}
      search={globalSearchAction}
      sidebar={
        <Sidebar
          sections={sections}
          counters={shell.counters}
          userBlock={
            <ProfileMenu
              user={{ name: actor.name, email: actor.email, roleLabel }}
              title={shell.title ?? actor.name}
              detail={shell.detail ?? `Nuera Studio · ${roleLabel.toLocaleLowerCase("fr-FR")}`}
              people={shell.people}
              notifications={shell.notifications}
              canManageAgency={can(actor, "integrations:read")}
              chatgptLabel={shell.chatgptLabel}
              saveTheme={saveThemeAction}
            />
          }
        />
      }
    >
      {shell.appearance ? <AppearanceSync appearance={shell.appearance} /> : null}
      <PageBuild>{children}</PageBuild>
    </AppShell>
  );
}

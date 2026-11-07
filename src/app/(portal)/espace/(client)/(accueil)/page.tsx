import type { Metadata } from "next";
import { PORTAL_PAGE, PortalPageHeader } from "@/components/portal/portal-card";
import { EmptyState } from "@/components/states/states";
import { CompactLink } from "@/components/ui/compact-button";
import { PortalGuide } from "@/modules/portal/components/portal-guide";
import { ProjectHome } from "@/modules/portal/components/project-home";
import { ProjectSwitcher } from "@/modules/portal/components/project-switcher";
import { firstNameOf } from "@/modules/portal/portal.format";
import { loadPortalGuide, loadPortalHome, requirePortalPage } from "@/modules/portal/portal.page";

export const metadata: Metadata = { title: "Mon projet" };

/** Écran C3. Sans projet : un vrai état vide, et le fil de messages reste ouvert. */
export default async function PortalHomePage() {
  await requirePortalPage();
  const [data, { showGuide }] = await Promise.all([loadPortalHome(), loadPortalGuide()]);
  const firstName = data.identity.firstName || firstNameOf(data.identity.fullName);
  const greeting = firstName ? `Bonjour ${firstName}` : "Bonjour";
  const guide = showGuide ? <PortalGuide firstName={firstName || null} /> : null;

  if (!data.home) {
    return (
      <div className={PORTAL_PAGE}>
        {guide}
        <PortalPageHeader title={greeting} />
        <EmptyState
          icon="projets"
          title="Aucun projet en cours pour l'instant"
          description="Dès qu'un projet démarre avec Nuera Studio, vous suivez ici son avancement, ce qu'il nous faut de votre part et les versions à valider."
          action={
            <CompactLink variant="secondary" icon="messages" href="/espace/messages">
              Nous écrire
            </CompactLink>
          }
        />
      </div>
    );
  }

  return (
    <>
      {guide}
      <ProjectHome
        home={data.home}
        greeting={greeting}
        now={new Date()}
        switcher={
          data.projects.length > 1 ? (
            <ProjectSwitcher projects={data.projects} selectedId={data.home.project.id} />
          ) : null
        }
      />
    </>
  );
}

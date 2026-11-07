import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClientMotionPreset } from "@/components/motion/motion-provider";
import { ClientCapsule } from "@/components/portal/ClientCapsule";
import { PORTAL_FILL } from "@/components/portal/portal-card";
import "@/components/portal/portal-fit.css";
import { Badge } from "@/components/ui/badge";
import type { MenuEntry } from "@/components/ui/popover";
import { restartGuideAction } from "@/modules/portal/portal.actions";
import { formatDayMonth } from "@/modules/portal/portal.format";
import { loadPortalHome, requirePortalPage } from "@/modules/portal/portal.page";
import type { PortalHome } from "@/modules/portal/portal.service";

export const metadata: Metadata = {
  title: { default: "Mon espace", template: "%s · Mon espace" },
  robots: { index: false, follow: false },
};

function capsuleProgress(data: PortalHome) {
  const project = data.home?.project;
  if (!project || project.phases.length === 0) return undefined;
  const { phases } = project;
  const currentIndex = phases.findIndex((phase) => phase.state === "current");
  const doneCount = phases.filter((phase) => phase.state === "done").length;
  const position = currentIndex >= 0 ? currentIndex + 1 : Math.min(doneCount + 1, phases.length);
  const label = project.stepLabel ?? phases[position - 1]?.name ?? project.name;
  const delivery = project.dueOn ? formatDayMonth(project.dueOn) : null;
  return {
    steps: phases.map((phase) => phase.state),
    label,
    ariaLabel: `Avancement : étape ${position} sur ${phases.length}, ${label}${delivery ? `, mise en ligne le ${delivery}` : ""}`,
    hint: delivery ? `Mise en ligne le ${delivery}` : undefined,
  };
}

function menuItems(data: PortalHome): MenuEntry[] {
  const liveSite = data.sites.find((site) => site.status === "live" && site.url);
  const names = data.home?.interlocutorNames ?? "Nuera Studio";
  return [
    { key: "profile", label: "Mon profil", icon: "clients", href: "/espace/profil" },
    {
      key: "notifications",
      label: "Notifications par e-mail",
      icon: "bell",
      href: "/espace/profil",
      aside: data.notificationsOn ? (
        <Badge tone="success">Activées</Badge>
      ) : (
        <Badge tone="neutral">Désactivées</Badge>
      ),
    },
    ...(liveSite?.url
      ? [{ key: "site", label: "Mon site en ligne", icon: "globe2" as const, href: liveSite.url }]
      : []),
    { key: "tickets", label: "Mes demandes", icon: "support", href: "/espace/demandes" },
    { key: "write", label: `Écrire à ${names}`, icon: "messages", href: "/espace/messages" },
  ];
}

/**
 * Espace client : capsule + contenu. À partir de 1024 px, l'ensemble tient dans la hauteur de l'écran
 * (`portal-fit.css`, `PORTAL_FILL`) ; en dessous, la page défile normalement. L'adhésion est relue à chaque requête : un accès
 * révoqué s'arrête ici, sans attendre. Chaque page refait ce contrôle.
 */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePortalPage();
  const data = await loadPortalHome();

  return (
    <ClientMotionPreset>
      <div className="flex min-h-dvh flex-col bg-bg">
        <ClientCapsule
          progress={capsuleProgress(data)}
          nextAction={data.nextAction ?? undefined}
          messagesCount={data.unread}
          user={{ name: ctx.actor.name, email: ctx.actor.email }}
          menuItems={menuItems(data)}
          onReplayGuide={restartGuideAction}
        />
        <main
          className={`portal-fit anim-content mx-auto w-full max-w-[1440px] px-4 pt-6 pb-16 sm:px-[40px] lg:flex lg:max-w-none lg:flex-col lg:pt-2 lg:pb-4 ${PORTAL_FILL}`}
        >
          {children}
        </main>
      </div>
    </ClientMotionPreset>
  );
}

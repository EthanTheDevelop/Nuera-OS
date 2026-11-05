import type { Metadata } from "next";
import { ClientMotionPreset } from "@/components/motion/motion-provider";
import { ForbiddenState } from "@/components/states/states";
import { CompactLink } from "@/components/ui/compact-button";
import { Alert } from "@/components/ui/feedback";
import { ProjectHome } from "@/modules/portal/components/project-home";
import { loadAgencyPreview } from "@/modules/portal/portal-access.service";
import { orNotFound } from "@/modules/portal/portal.page";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Vue de l'agence",
  robots: { index: false, follow: false },
};

/**
 * C3 vu par l'agence : les sections du client, en lecture seule, sans aucune action branchée. Un
 * client qui ouvre cette adresse part vers son espace (`getServiceContext`). Le prestataire, qui n'a
 * pas `projects:read`, voit le refus.
 */
export default async function AgencyPortalPreviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "projects:read")) return <ForbiddenState />;
  const { projectId } = await params;
  const home = await orNotFound(() => loadAgencyPreview(ctx, projectId));

  return (
    <ClientMotionPreset>
      <main className="anim-content mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col gap-6 bg-bg px-4 pt-6 pb-16 sm:px-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Alert tone="info" className="min-w-0 flex-1 basis-80">
            <strong>Vue de l&apos;agence.</strong> Voici ce que voit le client sur ce projet. Aperçu
            en lecture seule : rien ne s&apos;y modifie.
          </Alert>
          <CompactLink variant="secondary" href={`/projets/${projectId}`}>
            Retour au projet
          </CompactLink>
        </div>
        <ProjectHome home={home} greeting="Bonjour" now={new Date()} readOnly />
      </main>
    </ClientMotionPreset>
  );
}

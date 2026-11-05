import { ForbiddenState } from "@/components/states/states";
import { AgencyForm } from "@/modules/admin/components/agency-form";
import { getAgencyProfile } from "@/modules/platform/settings.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

/** Onglet Agence, non dessiné : la fiche sert d'adresse de réponse aux e-mails sortants. */
export default async function AgencySettingsPage() {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "integrations:read")) return <ForbiddenState />;
  const profile = await getAgencyProfile(ctx.db);
  return <AgencyForm profile={profile} canEdit={can(ctx.actor, "admin:manage")} />;
}

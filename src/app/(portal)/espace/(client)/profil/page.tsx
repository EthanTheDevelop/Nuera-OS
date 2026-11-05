import type { Metadata } from "next";
import { ProfileForm } from "@/modules/portal/components/profile-form";
import { requirePortalPage } from "@/modules/portal/portal.page";
import { getPortalProfile } from "@/modules/portal/portal.service";

export const metadata: Metadata = { title: "Mon profil" };

/** Écran C8. */
export default async function PortalProfilePage() {
  const ctx = await requirePortalPage();
  const { identity, preferences, devices } = await getPortalProfile(ctx);
  return (
    <ProfileForm
      name={ctx.actor.name}
      email={ctx.actor.email}
      companyName={identity.companyName}
      phone={identity.phone}
      preferences={preferences}
      devices={devices}
    />
  );
}

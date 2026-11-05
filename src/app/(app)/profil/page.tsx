import type { Metadata } from "next";
import { visibleNavigation } from "@/config/navigation";
import { ProfileScreen } from "@/modules/admin/components/profile-screen";
import { getProfile } from "@/modules/admin/profile.service";
import { canAny } from "@/server/auth/permissions";
import { getCurrentSessionId, getEnrolmentServiceContext } from "@/server/auth/session";
import { getEnv } from "@/server/config/env";

export const metadata: Metadata = { title: "Mon profil" };

/**
 * Écran 14. Passe par `getEnrolmentServiceContext` : un compte qui doit activer sa double
 * authentification y a toujours accès. Google Agenda et Figma ne sont pas livrés (A9).
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getEnrolmentServiceContext();
  const params = await searchParams;
  const profile = await getProfile(ctx, {
    currentSessionId: await getCurrentSessionId(),
    nodeEnv: getEnv().NODE_ENV,
  });
  const homeOptions = visibleNavigation((permissions) => canAny(ctx.actor, permissions)).flatMap(
    (section) => section.items.map(({ href, label }) => ({ href, label })),
  );
  return (
    <ProfileScreen
      profile={profile}
      homeOptions={homeOptions}
      enrolmentRequired={params["double-authentification"] === "requise"}
    />
  );
}

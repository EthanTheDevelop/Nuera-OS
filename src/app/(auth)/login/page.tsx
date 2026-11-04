import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { isInternalRole } from "@/server/auth/roles";
import { getCurrentActor } from "@/server/auth/session";
import { AuthScreen } from "../auth-card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  const redirectTo = safeRedirectPath(next);

  const actor = await getCurrentActor();
  if (actor) redirect(isInternalRole(actor.role) ? redirectTo : "/espace");

  return (
    <AuthScreen>
      <LoginForm redirectTo={redirectTo} />
    </AuthScreen>
  );
}

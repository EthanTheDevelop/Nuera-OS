import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getCurrentActor } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  const redirectTo = safeRedirectPath(next);

  if (await getCurrentActor()) redirect(redirectTo);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-line bg-surface p-6">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Connexion à Nuera OS</h1>
          <p className="text-ink-muted">Accès réservé aux comptes créés par un administrateur.</p>
        </div>
        <LoginForm redirectTo={redirectTo} />
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, AuthScreen } from "../../auth-card";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

/** Arrivée du lien reçu par e-mail : better-auth y ajoute `?token=…`, ou `?error=…` s'il a expiré. */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, error } = await searchParams;

  return (
    <AuthScreen>
      {typeof token === "string" && !error ? (
        <ResetPasswordForm token={token} />
      ) : (
        <AuthCard
          title="Ce lien n’est plus valable"
          description="Pour votre sécurité, un lien de réinitialisation expire au bout d’une heure. Demandez-en un nouveau depuis la page de connexion."
        >
          <Link
            href="/login"
            className="hit-44 self-start text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            Revenir à la connexion
          </Link>
        </AuthCard>
      )}
    </AuthScreen>
  );
}

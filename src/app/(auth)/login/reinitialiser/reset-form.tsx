"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { getAuthClient } from "@/lib/auth-client";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/auth/password-policy";
import { AuthCard } from "../../auth-card";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== form.get("confirmation")) {
      setError("Les deux mots de passe ne sont pas identiques.");
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Choisissez au moins ${PASSWORD_MIN_LENGTH} caractères.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const { error: resetError } = await getAuthClient().resetPassword({
        newPassword: password,
        token,
      });
      if (resetError) {
        setError(
          resetError.code === "INVALID_TOKEN"
            ? "Ce lien n’est plus valable. Demandez-en un nouveau depuis la page de connexion."
            : "Le mot de passe n’a pas pu être changé. Réessayez dans quelques instants.",
        );
        return;
      }
      router.replace("/login");
    });
  }

  return (
    <AuthCard
      title="Nouveau mot de passe"
      description={`Au moins ${PASSWORD_MIN_LENGTH} caractères.`}
    >
      <form method="post" onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="password" label="Nouveau mot de passe">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            autoFocus
            required
            className="rounded-sm"
          />
        </Field>
        <Field id="confirmation" label="Le même, une seconde fois">
          <Input
            id="confirmation"
            name="confirmation"
            type="password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX_LENGTH}
            required
            className="rounded-sm"
          />
        </Field>
        <Button type="submit" variant="accent" loading={pending} className="self-start">
          Enregistrer
        </Button>
      </form>
    </AuthCard>
  );
}

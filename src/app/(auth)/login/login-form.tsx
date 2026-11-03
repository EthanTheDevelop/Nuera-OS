"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { getAuthClient } from "@/lib/auth-client";

/** Message volontairement générique : ne révèle pas si l'adresse existe. */
function signInErrorMessage(error: { status?: number; code?: string }): string {
  if (error.status === 429)
    return "Trop de tentatives. Patientez quelques instants avant de réessayer.";
  if (error.code === "BANNED_USER") return "Ce compte est désactivé. Contactez un administrateur.";
  if (error.status === 400 || error.status === 401)
    return "Adresse e-mail ou mot de passe incorrect.";
  return "Connexion impossible pour le moment. Réessayez dans quelques instants.";
}

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);

    startTransition(async () => {
      const { error: signInError } = await getAuthClient().signIn.email({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      if (signInError) {
        setError(signInErrorMessage(signInError));
        return;
      }
      router.replace(redirectTo);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field id="email" label="Adresse e-mail">
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Field id="password" label="Mot de passe">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Connexion…" : "Se connecter"}
      </Button>
    </form>
  );
}

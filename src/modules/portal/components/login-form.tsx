"use client";

import { useState, useTransition, type FormEvent } from "react";
import { CompactButton } from "@/components/ui/compact-button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { getAuthClient } from "@/lib/auth-client";

/**
 * Écran C2. La réponse est la même que l'adresse soit connue ou non (domain-model §9) : le texte de
 * succès le dit honnêtement, sans affirmer qu'un lien est parti vers une adresse inconnue.
 */
export function PortalLoginForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setError(null);
    setSentTo(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Cette adresse e-mail ne semble pas valide. Vérifiez-la et réessayez.");
      return;
    }
    startTransition(async () => {
      const { error: failure } = await getAuthClient().signIn.magicLink({
        email: address,
        callbackURL: "/espace",
        errorCallbackURL: "/espace/lien-expire",
      });
      if (failure?.status === 429) {
        setError("Trop de demandes. Patientez une minute avant de réessayer.");
        return;
      }
      if (failure?.status && failure.status >= 500) {
        setError("L'envoi n'a pas pu démarrer. Réessayez dans quelques instants.");
        return;
      }
      setSentTo(address);
    });
  }

  return (
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field id="portal-email" label="Adresse e-mail">
        <Input
          id="portal-email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          aria-invalid={error ? true : undefined}
        />
      </Field>
      <div>
        <CompactButton type="submit" icon="send" loading={pending}>
          Recevoir mon lien de connexion
        </CompactButton>
      </div>
      {sentTo ? (
        <Alert tone="success">
          Si {sentTo} est reliée à un espace, le lien arrive dans quelques instants. Pensez à
          regarder vos indésirables.
        </Alert>
      ) : null}
    </form>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { AuthCard, AuthScreen } from "./(auth)/auth-card";
import "./globals.css";

/** Dernier filet : erreur dans le layout racine. Aucun détail technique affiché. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr" data-theme="light">
      <body>
        <AuthScreen>
          <AuthCard title="Nuera OS est momentanément indisponible">
            <p className="text-sm text-muted">
              L’application a rencontré un problème. Réessayez dans quelques instants.
            </p>
            {error.digest ? (
              <p className="font-mono text-xs text-muted">Référence : {error.digest}</p>
            ) : null}
            <Button variant="accent" onClick={reset} className="self-start">
              Réessayer
            </Button>
          </AuthCard>
        </AuthScreen>
      </body>
    </html>
  );
}

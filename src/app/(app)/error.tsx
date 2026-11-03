"use client";

import { Button } from "@/components/ui/button";

/** Erreur inattendue dans une page : message générique + référence pour le support. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="space-y-3">
      <h1 className="text-lg font-semibold">Une erreur est survenue</h1>
      <p className="text-ink-muted">
        La page n&apos;a pas pu être affichée. Si le problème persiste, transmettez la référence au
        support.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-ink-subtle">Référence : {error.digest}</p>
      ) : null}
      <Button variant="secondary" onClick={reset}>
        Réessayer
      </Button>
    </div>
  );
}

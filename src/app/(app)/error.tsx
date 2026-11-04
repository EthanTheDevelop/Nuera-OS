"use client";

import { ErrorState } from "@/components/states/states";
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
    <ErrorState
      title="Cette page n’a pas pu s’afficher"
      description="Si le problème persiste, transmettez la référence au support."
      reference={error.digest}
      action={<Button onClick={reset}>Réessayer</Button>}
    />
  );
}

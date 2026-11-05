"use client";

import { ErrorState } from "@/components/states/states";
import { CompactButton } from "@/components/ui/compact-button";

/** Erreur inattendue : message générique, jamais de détail interne, référence pour nous écrire. */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Cette page n'a pas pu s'afficher"
      description="Réessayez dans un instant. Si cela continue, écrivez-nous à bonjour@nuera.studio en indiquant la référence."
      reference={error.digest}
      action={<CompactButton onClick={reset}>Réessayer</CompactButton>}
    />
  );
}

"use client";

import { Button } from "@/components/ui/button";

/** Ouvre la boîte d'impression du navigateur : « Enregistrer au format PDF » y est proposé. */
export function PrintButton() {
  return (
    <Button variant="accent" icon="download" onClick={() => window.print()}>
      Imprimer ou enregistrer en PDF
    </Button>
  );
}

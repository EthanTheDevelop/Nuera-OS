"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { dismissTipAction } from "../portal.actions";
import type { PortalTipKey } from "../portal.schema";

/**
 * Conseil d'une ligne, fermé pour de bon par son bouton. Il disparaît tout de suite : un échec
 * d'enregistrement n'arrête pas le client, le conseil reviendra simplement au prochain chargement.
 */
export function DismissibleTip({ tip, text }: { tip: PortalTipKey; text: string }) {
  const [closed, setClosed] = useState(false);
  const [, startTransition] = useTransition();
  if (closed) return null;
  return (
    <aside
      aria-label="Conseil"
      className="mb-4 flex shrink-0 items-center gap-2.5 rounded-lg bg-accent-pale py-1 pr-1 pl-3.5 text-sm text-ink lg:mb-2"
    >
      <Icon name="flag" size={16} className="shrink-0 text-accent" />
      <p className="min-w-0 flex-1">{text}</p>
      <button
        type="button"
        aria-label="Fermer ce conseil"
        onClick={() => {
          setClosed(true);
          startTransition(async () => {
            await dismissTipAction(tip).catch(() => undefined);
          });
        }}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-focus max-lg:size-11"
      >
        <Icon name="close" size={16} />
      </button>
    </aside>
  );
}

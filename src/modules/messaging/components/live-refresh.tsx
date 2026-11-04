"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

/** Intervalle de relecture : sans service de websocket, la page se relit quand elle est visible. */
const POLL_INTERVAL_MS = 15_000;

/**
 * Nouveaux messages par relecture du serveur. `router.refresh` garde l'état des composants clients
 * (champ en cours de saisie, position) : seules les données changées entrent à l'écran.
 */
export function LiveRefresh() {
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    };
    const timer = window.setInterval(refresh, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  return null;
}

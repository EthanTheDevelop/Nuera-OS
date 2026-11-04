"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { refreshDeploymentsAction } from "../site.actions";

const POLL_MS = 5000;

/**
 * Suivi d'un déploiement en cours : relit Coolify toutes les 5 s, seulement tant qu'un déploiement
 * est actif et que l'onglet est visible. Le tableau change dès qu'un état change.
 */
export function DeploymentWatcher({ siteId, active }: { siteId: string; active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const result = await refreshDeploymentsAction(siteId);
      if (stopped) return;
      if (result.changed) router.refresh();
      if (!result.active) window.clearInterval(timer);
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [active, router, siteId]);

  return null;
}

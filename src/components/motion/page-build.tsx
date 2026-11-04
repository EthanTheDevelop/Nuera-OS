"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, type ReactNode } from "react";
import {
  isPageSeen,
  isShellSeen,
  markPageSeen,
  markShellSeen,
  startPageBuild,
} from "./build-state";

/** Dernière page décidée : les effets rejoués (React strict) ne doivent pas changer l'avis. */
let decidedPage: string | null = null;
let shellDecided = false;

/**
 * Construction en cascade d'une page, cadre → contenu → données (motion.md §2.1).
 *
 * Enveloppe le contenu de la page ; les éléments portent `anim-header`, `anim-content`,
 * `anim-data` (Tile, PageHeader, Gauge, charts le font seuls). Les délais viennent du CSS, la
 * décision de jouer ou non de `html[data-page-seen]` : une page déjà vue dans la session arrive
 * en place, seules ses données changées bougent.
 */
export function PageBuild({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Avant la peinture : le nouveau contenu ne doit pas démarrer son animation pour rien.
  useLayoutEffect(() => {
    if (decidedPage === pathname) return;
    const hardLoad = decidedPage === null;
    decidedPage = pathname;
    const seen = isPageSeen(pathname);
    document.documentElement.toggleAttribute("data-page-seen", seen);
    startPageBuild(seen, hardLoad);
    markPageSeen(pathname);
  }, [pathname]);

  return (
    <div data-page-build className="contents">
      {children}
    </div>
  );
}

/** Arrivée de la coque (barre latérale) : une seule fois par session. */
export function ShellBuild({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    if (shellDecided) return;
    shellDecided = true;
    document.documentElement.toggleAttribute("data-shell-seen", isShellSeen());
    markShellSeen();
  }, []);

  return (
    <div data-shell className="contents">
      {children}
    </div>
  );
}

/** Rejoue les entrées d'un sous-arbre malgré une page déjà vue (fenêtre, changement de mesure). */
export function Replay({ children }: { children: ReactNode }) {
  return (
    <div data-replay className="contents">
      {children}
    </div>
  );
}

"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { BUILD_STORAGE_KEY } from "./build-state";

/**
 * Script bloquant de `<head>`, autorisé par le nonce de la requête.
 * Il décide AVANT le premier rendu si la cascade doit jouer (motion.md §6 : première ouverture dans
 * la session seulement) et résout le thème `auto`. Ces données restent dans le navigateur : le
 * serveur ne peut pas les connaître, d'où ce script plutôt qu'un état React.
 */
const SCRIPT = `(function(){var d=document.documentElement;try{var s=JSON.parse(sessionStorage.getItem(${JSON.stringify(
  BUILD_STORAGE_KEY,
)})||"{}");if(s.shell)d.setAttribute("data-shell-seen","");if(s.pages&&s.pages[location.pathname])d.setAttribute("data-page-seen","")}catch(e){}if(d.getAttribute("data-theme")==="auto")d.setAttribute("data-theme",matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")})();`;

const subscribe = () => () => {};
const onClient = () => false;
const onServer = () => true;

/**
 * Le script n'existe que dans le HTML du serveur. Quand `notFound()` part d'une page, Next.js jette
 * ce HTML et rend tout le document dans le navigateur : un `<script>` créé par React n'y est jamais
 * exécuté, et React le signale en développement. Ce rendu-là n'en crée donc pas, et résout le thème
 * lui-même. À l'hydratation, le script déjà exécuté est repris, puis retiré au rendu suivant.
 */
export function BuildScript({ nonce }: { nonce?: string }) {
  const rendersScript = useSyncExternalStore(subscribe, onClient, onServer);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute("data-theme") === "auto") {
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      root.setAttribute("data-theme", dark ? "dark" : "light");
    }
  }, []);

  return rendersScript ? (
    <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCRIPT }} />
  ) : null;
}

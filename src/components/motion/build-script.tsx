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

export function BuildScript({ nonce }: { nonce?: string }) {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}

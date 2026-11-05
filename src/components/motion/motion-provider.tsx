"use client";

import { MotionConfig, useReducedMotion } from "motion/react";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { motionPreset, type MotionPreset } from "@/lib/motion";

interface MotionSettings {
  nonce?: string;
  /** Préréglage sobre du portail client (motion.md §4). */
  client: boolean;
}

const MotionSettingsContext = createContext<MotionSettings>({ client: false });

/**
 * Nonce de la CSP du document, lu une fois au chargement du module, sur les scripts déjà parsés.
 * Il ne change qu'avec le document, alors que le layout racine peut être rejoué sans recharger la page
 * (connexion, action serveur) et apporter le nonce d'une autre requête, que le navigateur refuse.
 */
const DOCUMENT_NONCE =
  typeof document === "undefined"
    ? undefined
    : document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce || undefined;

/**
 * Racine du mouvement, posée par le layout racine.
 * `nonce` : Motion et NumberFlow injectent des `<style>`, autorisés par la CSP à ce nonce. Le serveur
 * passe celui de sa requête ; dans le navigateur, seul celui du document fait foi.
 * `reducedMotion="user"` : garde-fou pour les animations de disposition (`layout`, `layoutId`).
 */
export function MotionProvider({
  nonce: requestNonce,
  children,
}: {
  nonce?: string;
  children: ReactNode;
}) {
  const nonce = DOCUMENT_NONCE ?? requestNonce;
  const settings = useMemo(() => ({ nonce, client: false }), [nonce]);
  return (
    <MotionSettingsContext.Provider value={settings}>
      <MotionConfig reducedMotion="user" nonce={nonce}>
        {children}
      </MotionConfig>
    </MotionSettingsContext.Provider>
  );
}

/**
 * Bascule un sous-arbre sur le préréglage client : fondu de 250 ms, pas de flou ni de compteur.
 * À poser dans le layout du portail. `data-motion` pilote le CSS, le contexte pilote Motion.
 */
export function ClientMotionPreset({ children }: { children: ReactNode }) {
  const parent = useContext(MotionSettingsContext);
  const settings = useMemo(() => ({ ...parent, client: true }), [parent]);
  return (
    <MotionSettingsContext.Provider value={settings}>
      <div data-motion="client" className="contents">
        {children}
      </div>
    </MotionSettingsContext.Provider>
  );
}

/** Nonce de la requête, à transmettre à toute bibliothèque qui injecte un `<style>`. */
export function useStyleNonce(): string | undefined {
  return useContext(MotionSettingsContext).nonce;
}

export function useIsClientPreset(): boolean {
  return useContext(MotionSettingsContext).client;
}

/** Variantes à utiliser avec Motion : tiennent compte du système et du préréglage client. */
export function useMotionPreset(): MotionPreset {
  const reduced = useReducedMotion() ?? false;
  const { client } = useContext(MotionSettingsContext);
  return useMemo(() => motionPreset({ reduced, client }), [reduced, client]);
}

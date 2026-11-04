/**
 * Jetons de mouvement (docs/design/motion.md §3, tokens.md §7).
 *
 * Aucune durée en dur dans un composant : tout passe par ce fichier côté Motion, ou par les
 * variables CSS miroir de `src/app/globals.css` côté feuille de style (égalité testée).
 * Fichier sans dépendance : importable aussi bien côté serveur que client.
 */

/** Durées en millisecondes. */
export const DURATION_MS = {
  /** Retour au clic. */
  instant: 60,
  /** Réaction à un clic ou un survol. Arbitrage A8 : 150 ms au plus. */
  fast: 150,
  /** Fermeture d'une fenêtre, sortie d'un graphique. */
  exit: 200,
  /** Trait d'onglet, message qui entre. */
  tab: 250,
  /** Fondu unique du portail client. */
  client: 250,
  /** Une carte qui change de colonne. */
  move: 300,
  /** Entrée type d'un élément. */
  base: 350,
  /** Une barre qui monte. */
  bar: 500,
  /** Une jauge qui se remplit. */
  gauge: 600,
  /** Révélation au défilement. */
  reveal: 750,
  /** Une courbe qui se trace. */
  line: 800,
  /** Remplissage long. */
  slow: 900,
  /** Tout effet, sous `prefers-reduced-motion`. */
  reduced: 150,
} as const;

/** Écarts de cascade, en millisecondes. */
export const STAGGER_MS = { bar: 25, menu: 30, card: 60 } as const;

/** Début de chaque couche de la construction d'une page (motion.md §2.1), en millisecondes. */
export const BUILD_MS = { frame: 250, content: 600, data: 1000 } as const;

/** Courbes d'accélération (bézier cubiques). */
export const EASE = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
  emphasis: [0.32, 0.72, 0, 1],
  steady: [0.4, 0, 0.2, 1],
  exit: [0.4, 0, 1, 1],
} as const;

/** Entrée type : opacité 0 → 1, flou 6 px → 0, glissement de 6 px vers le haut. */
export const ENTER_OFFSET = { blur: 6, y: 6 } as const;

/** Taille de départ d'une fenêtre : 90 % → 100 %. */
export const WINDOW_SCALE_FROM = 0.9;

/** Flou d'arrière-plan d'une fenêtre, en pixels (note M3). */
export const WINDOW_BACKDROP_BLUR = 6;

const seconds = (ms: number) => ms / 1000;

type Bezier = readonly [number, number, number, number];

export interface MotionTransition {
  duration: number;
  ease: Bezier;
  delay?: number;
  staggerChildren?: number;
  delayChildren?: number;
}

export function transition(ms: number, ease: Bezier = EASE.out, delayMs = 0): MotionTransition {
  return { duration: seconds(ms), ease, ...(delayMs ? { delay: seconds(delayMs) } : {}) };
}

/**
 * Préréglage de mouvement : variantes prêtes à passer à Motion.
 * `reduced` est obligatoire et prioritaire : plus de flou, de translation, de mise à l'échelle ni
 * de cascade, seulement un fondu de 150 ms.
 */
export function motionPreset({ reduced, client = false }: { reduced: boolean; client?: boolean }) {
  const fade = transition(DURATION_MS.reduced, [0, 0, 1, 1]);

  if (reduced) {
    return {
      reduced: true as const,
      enter: { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: fade },
      leave: { opacity: 0, transition: fade },
      window: {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: fade },
        exit: { opacity: 0, transition: fade },
      },
      veil: {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: fade },
        exit: { opacity: 0, transition: fade },
      },
      cascade: { hidden: {}, visible: {} },
      row: { hidden: { opacity: 0 }, visible: { opacity: 1, transition: fade } },
      move: fade,
      tab: fade,
      swapOut: { opacity: 0, transition: fade },
      swapIn: { initial: { opacity: 0 }, animate: { opacity: 1, transition: fade } },
      message: { initial: { opacity: 0 }, animate: { opacity: 1, transition: fade } },
    };
  }

  const enterTransition = client ? transition(DURATION_MS.client) : transition(DURATION_MS.base);
  const enterInitial = client
    ? { opacity: 0 }
    : {
        opacity: 0,
        filter: `blur(${ENTER_OFFSET.blur}px)`,
        y: ENTER_OFFSET.y,
      };
  const enterAnimate = client ? { opacity: 1 } : { opacity: 1, filter: "blur(0px)", y: 0 };
  const exitTransition = transition(DURATION_MS.exit, EASE.exit);

  return {
    reduced: false as const,
    enter: { initial: enterInitial, animate: enterAnimate, transition: enterTransition },
    leave: { opacity: 0, transition: exitTransition },
    /** La fenêtre : 90 → 100 %, fondu, légère montée (motion.md §2.6). */
    window: {
      initial: { opacity: 0, scale: WINDOW_SCALE_FROM, y: 8 },
      animate: { opacity: 1, scale: 1, y: 0, transition: transition(DURATION_MS.move) },
      exit: { opacity: 0, scale: 0.97, transition: exitTransition },
    },
    veil: {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: transition(DURATION_MS.move) },
      exit: { opacity: 0, transition: exitTransition },
    },
    /** Le contenu d'une fenêtre arrive rangée par rangée, 60 ms d'écart. */
    cascade: {
      hidden: {},
      visible: {
        transition: {
          staggerChildren: seconds(STAGGER_MS.card),
          delayChildren: seconds(DURATION_MS.exit),
        },
      },
    },
    row: {
      hidden: enterInitial,
      visible: { ...enterAnimate, transition: enterTransition },
    },
    move: transition(DURATION_MS.move, EASE.emphasis),
    tab: transition(DURATION_MS.tab, EASE.emphasis),
    swapOut: { opacity: 0, y: 8, transition: exitTransition },
    swapIn: {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: transition(DURATION_MS.fast) },
    },
    message: {
      initial: { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0, transition: transition(DURATION_MS.tab) },
    },
  };
}

export type MotionPreset = ReturnType<typeof motionPreset>;

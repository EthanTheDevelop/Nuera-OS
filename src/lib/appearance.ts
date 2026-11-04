/**
 * Apparence : thème, couleur d'accent, densité (écran 14, arbitrage A13).
 *
 * Portée par des cookies lus par le layout racine : le premier HTML est déjà au bon thème,
 * sans clignotement. Le lot Administration persiste aussi ces choix en base (`user_preferences`)
 * et appelle `writeAppearance` pour les appliquer au navigateur.
 */
export const THEMES = ["light", "dark", "auto"] as const;
export type Theme = (typeof THEMES)[number];

export const ACCENTS = ["blue", "ink", "chatgpt", "warn", "danger"] as const;
export type Accent = (typeof ACCENTS)[number];

export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

export interface Appearance {
  theme: Theme;
  accent: Accent;
  density: Density;
}

export const APPEARANCE_COOKIES = {
  theme: "nuera-theme",
  accent: "nuera-accent",
  density: "nuera-density",
} as const;

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "light",
  accent: "blue",
  density: "comfortable",
};

function pick<T extends string>(allowed: readonly T[], value: string | undefined, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Lit l'apparence depuis un lecteur de cookies ; toute valeur inconnue retombe sur le défaut. */
export function readAppearance(read: (name: string) => string | undefined): Appearance {
  return {
    theme: pick(THEMES, read(APPEARANCE_COOKIES.theme), DEFAULT_APPEARANCE.theme),
    accent: pick(ACCENTS, read(APPEARANCE_COOKIES.accent), DEFAULT_APPEARANCE.accent),
    density: pick(DENSITIES, read(APPEARANCE_COOKIES.density), DEFAULT_APPEARANCE.density),
  };
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Applique tout de suite au document et mémorise dans les cookies. Navigateur uniquement. */
export function writeAppearance(patch: Partial<Appearance>): void {
  const root = document.documentElement;
  if (patch.theme) {
    root.dataset.theme = resolveTheme(patch.theme);
    writeCookie(APPEARANCE_COOKIES.theme, patch.theme);
  }
  if (patch.accent) {
    root.dataset.accent = patch.accent;
    writeCookie(APPEARANCE_COOKIES.accent, patch.accent);
  }
  if (patch.density) {
    root.dataset.density = patch.density;
    writeCookie(APPEARANCE_COOKIES.density, patch.density);
  }
}

/** Thème réellement affiché : `auto` suit le réglage du système. Navigateur uniquement. */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "auto") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function writeCookie(name: string, value: string): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  // Choix d'affichage sans valeur de sécurité, lu aussi par le serveur : pas de HttpOnly.
  document.cookie = `${name}=${value}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}

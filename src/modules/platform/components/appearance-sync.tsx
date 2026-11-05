"use client";

import { useEffect } from "react";
import { APPEARANCE_COOKIES, readAppearance, writeAppearance } from "@/lib/appearance";

function cookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/**
 * L'apparence s'affiche depuis des cookies, lus par le serveur avant le premier rendu. Sur un
 * navigateur qui n'en a pas encore, on y recopie le choix enregistré du compte (écran 14). Une fois
 * le cookie posé, il reste le choix de ce navigateur.
 */
export function AppearanceSync({
  appearance,
}: {
  appearance: { theme: string; accent: string | null; density: string };
}) {
  useEffect(() => {
    if (cookie(APPEARANCE_COOKIES.theme)) return;
    const theme = appearance.theme === "system" ? "auto" : appearance.theme;
    writeAppearance(
      readAppearance(
        (name) =>
          ({
            [APPEARANCE_COOKIES.theme]: theme,
            [APPEARANCE_COOKIES.accent]: appearance.accent ?? undefined,
            [APPEARANCE_COOKIES.density]: appearance.density,
          })[name],
      ),
    );
  }, [appearance]);
  return null;
}

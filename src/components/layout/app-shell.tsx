"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ShellBuild } from "@/components/motion/page-build";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { CommandPalette, type CommandItem, type CommandSearch } from "./command-palette";
import { Logo } from "./logo";
import { ShellContext } from "./shell-context";

/**
 * Coque de l'agence : barre latérale + contenu. Figma n'a pas de barre haute globale ; sous 1024 px,
 * la barre latérale devient un tiroir et une fine barre porte le bouton et la recherche.
 *
 * `search` : Server Action de recherche globale (⌘K). Absente, ⌘K navigue dans les pages.
 */
export function AppShell({
  sidebar,
  navigation,
  search,
  children,
}: {
  /** La barre latérale, rendue par le serveur. */
  sidebar: ReactNode;
  /** Entrées de navigation accessibles, pour ⌘K. */
  navigation: readonly CommandItem[];
  search?: CommandSearch;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const [lastPathname, setLastPathname] = useState(pathname);

  // Une navigation referme le tiroir.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setDrawerOpen(false);
  }

  const openCommandPalette = useCallback(() => {
    setDrawerOpen(false);
    setPaletteOpen(true);
  }, []);
  const shell = useMemo(() => ({ openCommandPalette }), [openCommandPalette]);

  useEffect(() => {
    if (!drawerOpen) return;
    const panel = drawer.current;
    panel?.querySelector<HTMLElement>("a,button")?.focus({ preventScroll: true });
    const button = opener.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      button?.focus({ preventScroll: true });
    };
  }, [drawerOpen]);

  return (
    <ShellContext.Provider value={shell}>
      <a
        href="#contenu"
        className="fixed top-2 left-2 z-50 -translate-y-20 rounded-md bg-surface px-4 py-2 text-sm font-medium text-text shadow-float focus:translate-y-0"
      >
        Aller au contenu
      </a>

      <div className="flex min-h-dvh flex-col lg:flex-row">
        {/* Barre compacte, écrans étroits uniquement. */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 bg-near-black px-2 lg:hidden">
          <button
            ref={opener}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-controls="barre-laterale"
            aria-label="Ouvrir la navigation"
            className="flex size-11 items-center justify-center rounded-md text-paper"
          >
            <Icon name="menu" size={22} />
          </button>
          <Logo width={132} className="min-w-0" />
          <div className="flex-1" />
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Rechercher"
            className="flex size-11 items-center justify-center rounded-md text-paper"
          >
            <Icon name="search" size={20} />
          </button>
        </header>

        {/* Voile du tiroir. */}
        <button
          type="button"
          aria-label="Fermer la navigation"
          tabIndex={-1}
          onClick={() => setDrawerOpen(false)}
          className={cn(
            "fixed inset-0 z-40 bg-(--veil-menu) transition-opacity duration-(--dur-exit) lg:hidden",
            drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        />

        <aside
          ref={drawer}
          id="barre-laterale"
          className={cn(
            "fixed inset-y-0 left-0 z-50 h-dvh transition-[translate,visibility] duration-(--dur-move) ease-out",
            "lg:sticky lg:top-0 lg:z-20 lg:translate-x-0",
            drawerOpen ? "translate-x-0" : "max-lg:invisible max-lg:-translate-x-full",
          )}
        >
          <ShellBuild>{sidebar}</ShellBuild>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Fermer la navigation"
            className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-md text-paper lg:hidden"
          >
            <Icon name="close" size={20} />
          </button>
        </aside>

        <main id="contenu" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          <div className="mx-0 max-w-(--wrap-vast-w) px-4 pt-5 pb-12 has-[[data-page-wide]]:max-w-none lg:px-(--content-margin) lg:pt-7">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        navigation={navigation}
        search={search}
      />
    </ShellContext.Provider>
  );
}

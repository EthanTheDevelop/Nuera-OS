"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icon";

interface ShellActions {
  openCommandPalette: () => void;
}

export const ShellContext = createContext<ShellActions>({ openCommandPalette: () => {} });

export function useShell(): ShellActions {
  return useContext(ShellContext);
}

const noSubscribe = () => () => {};

/** Mac : ⌘K, comme Figma. Windows et Linux : Ctrl K, la touche réellement attendue. */
function useShortcutLabel(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"),
    () => "⌘K",
  );
}

/** Déclencheur de la recherche globale (Figma §2.1, étape 2). */
export function SidebarSearchTrigger() {
  const { openCommandPalette } = useShell();
  const shortcut = useShortcutLabel();
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-keyshortcuts="Meta+K Control+K"
      className="flex min-h-[32px] w-full items-center gap-2 rounded-sm bg-surface-raised-dark px-3 py-2 text-left text-accent-on-dark transition-colors duration-(--dur-fast) outline-none hover:bg-hairline-on-dark focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-on-dark max-lg:min-h-11"
    >
      <Icon name="search" size={16} />
      <span className="min-w-0 flex-1 text-nav-search">Rechercher…</span>
      <kbd className="font-mono text-kbd max-lg:hidden">{shortcut}</kbd>
    </button>
  );
}

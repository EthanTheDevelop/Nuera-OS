"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { DURATION_MS, WINDOW_BACKDROP_BLUR } from "@/lib/motion";

export interface CommandItem {
  id: string;
  label: string;
  /** Complément à droite : `Client`, `Devis D-2026-014`. */
  detail?: string;
  href: string;
  icon?: IconName;
}

export interface CommandGroup {
  label: string;
  items: readonly CommandItem[];
}

/** Server Action de recherche : reçoit la saisie, renvoie des groupes de résultats. */
export type CommandSearch = (query: string) => Promise<readonly CommandGroup[]>;

const SEARCH_DEBOUNCE_MS = DURATION_MS.instant * 3;

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr-FR");
}

/**
 * Recherche globale ⌘K / Ctrl K (figma-map §8 : aucune maquette, langage de la fenêtre).
 * Combobox ARIA : la saisie garde le focus, flèches et Entrée pilotent la liste.
 * Filtre toujours les pages accessibles. Avec `search`, interroge le serveur en plus.
 */
export function CommandPalette({
  open,
  onOpenChange,
  navigation,
  search,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navigation: readonly CommandItem[];
  search?: CommandSearch;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      if (!open && document.querySelector("dialog[open]:not([data-command-palette])")) return;
      event.preventDefault();
      onOpenChange(!open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  return (
    <AnimatePresence>
      {open ? (
        <PaletteDialog
          key="palette"
          onClose={() => onOpenChange(false)}
          navigation={navigation}
          search={search}
        />
      ) : null}
    </AnimatePresence>
  );
}

function PaletteDialog({
  onClose,
  navigation,
  search,
}: {
  onClose: () => void;
  navigation: readonly CommandItem[];
  search?: CommandSearch;
}) {
  const router = useRouter();
  const preset = useMotionPreset();
  const dialog = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<readonly CommandGroup[]>([]);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [highlight, setHighlight] = useState(0);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!search) return;
    const text = query.trim();
    if (text.length < 2) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        try {
          const groups = await search(text);
          if (stale) return;
          setRemote(groups);
          setFailed(false);
        } catch {
          if (!stale) setFailed(true);
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [query, search]);

  const groups = useMemo<readonly CommandGroup[]>(() => {
    const text = normalize(query.trim());
    const pages = text
      ? navigation.filter((item) => normalize(item.label).includes(text))
      : navigation;
    const results = query.trim().length >= 2 ? remote : [];
    return [...(pages.length ? [{ label: "Pages", items: pages }] : []), ...results];
  }, [navigation, query, remote]);

  const flat = groups.flatMap((group) => group.items);
  const active = flat[Math.min(highlight, Math.max(0, flat.length - 1))];
  const optionId = (item: CommandItem) => `${uid}-${item.id}`;

  function go(item: CommandItem) {
    onClose();
    router.push(item.href);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => (current + 1) % Math.max(1, flat.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => (current - 1 + flat.length) % Math.max(1, flat.length));
    } else if (event.key === "Enter" && active) {
      event.preventDefault();
      go(active);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Recherche globale"
      data-command-palette=""
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none items-start justify-center bg-transparent p-2 pt-[10vh] text-text sm:p-6 sm:pt-[12vh]"
    >
      <motion.div
        aria-hidden="true"
        initial={preset.veil.initial}
        animate={preset.veil.animate}
        exit={preset.veil.exit}
        onClick={onClose}
        style={{ backdropFilter: `blur(${WINDOW_BACKDROP_BLUR}px)` }}
        className="absolute inset-0 bg-(--veil-window)"
      />
      <motion.div
        initial={preset.window.initial}
        animate={preset.window.animate}
        exit={preset.window.exit}
        className="relative flex max-h-[70dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-lg bg-surface shadow-float"
      >
        <div className="flex items-center gap-3 border-b border-border px-5">
          <Icon name="search" size={18} className={cn("text-muted", pending && "anim-pulse")} />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-activedescendant={active ? optionId(active) : undefined}
            aria-autocomplete="list"
            aria-label="Rechercher"
            placeholder="Rechercher une page, un client, un projet…"
            className="h-14 min-w-0 flex-1 bg-transparent text-field text-text outline-none placeholder:text-muted"
          />
          <kbd className="rounded-sm bg-surface-raised px-1.5 py-1 font-mono text-kbd text-muted max-sm:hidden">
            Échap
          </kbd>
        </div>
        <div
          id={`${uid}-list`}
          role="listbox"
          aria-label="Résultats"
          className="min-h-0 overflow-y-auto p-2"
        >
          {failed ? (
            <p role="alert" className="px-3 py-2 text-sm text-danger">
              La recherche a échoué. Réessayez dans un instant.
            </p>
          ) : null}
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <p
                aria-hidden="true"
                className="px-3 pt-2 pb-1 font-mono text-nav-group text-muted uppercase"
              >
                {group.label}
              </p>
              {group.items.map((item) => {
                const isActive = item === active;
                return (
                  <button
                    key={item.id}
                    id={optionId(item)}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    tabIndex={-1}
                    onClick={() => go(item)}
                    onMouseEnter={() => setHighlight(flat.indexOf(item))}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-nav font-medium text-text",
                      isActive && "bg-accent-pale",
                    )}
                  >
                    {item.icon ? <Icon name={item.icon} size={18} className="text-ink" /> : null}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.detail ? (
                      <span className="shrink-0 text-xs font-normal text-muted">{item.detail}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && !pending && !failed ? (
            <p className="px-3 py-8 text-center text-sm text-muted">
              Aucun résultat pour « {query.trim()} ».
            </p>
          ) : null}
        </div>
      </motion.div>
    </dialog>
  );
}

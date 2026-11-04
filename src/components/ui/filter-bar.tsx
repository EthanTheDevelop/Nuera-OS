"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { hrefWith } from "@/lib/url-state";
import { DURATION_MS } from "@/lib/motion";
import { Icon } from "./icon";
import { PAGE_PARAM } from "./data-table";

/**
 * Filtre (écran 07) : badge Accent quand il est actif, Neutre sinon.
 * Vrai lien vers la même page : le paramètre `param` prend `value`, la pagination revient à 1.
 * `value` absent : le filtre « Tous », actif quand le paramètre est vide.
 */
export function FilterChip({
  param,
  value,
  tone = "accent",
  count,
  children,
}: {
  param: string;
  value?: string;
  /** Ton à l'état actif. */
  tone?: "accent" | "chatgpt";
  count?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = (searchParams.get(param) ?? undefined) === value;
  const href = hrefWith(pathname, searchParams, { [param]: value ?? null, [PAGE_PARAM]: null });

  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "hit-44 inline-flex shrink-0 items-center rounded-full px-2 py-1 text-badge whitespace-nowrap transition-colors duration-(--dur-fast) ease-out",
        active
          ? tone === "chatgpt"
            ? "bg-chatgpt-pale text-chatgpt"
            : "bg-accent-pale text-accent"
          : "bg-surface-raised text-muted hover:text-text",
      )}
    >
      {children}
      {count !== undefined ? <span className="tabular">&nbsp;·&nbsp;{count}</span> : null}
    </Link>
  );
}

/**
 * Champ de recherche (écran 07) : 260 × 36, rayon 12, icône 16.
 * Avec `param`, la saisie alimente l'URL (requête côté serveur, léger délai). Sans `param`, champ
 * ordinaire de formulaire, contrôlé ou non.
 */
export function SearchField({
  param,
  name,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Rechercher…",
  label = "Rechercher",
  className,
}: {
  param?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  if (param) {
    return (
      <UrlSearchField param={param} placeholder={placeholder} label={label} className={className} />
    );
  }
  return (
    <div className={cn("relative w-full sm:w-[260px]", className)}>
      <Icon
        name="search"
        size={16}
        className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
      />
      <input
        type="search"
        name={name}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => onValueChange?.(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        className={SEARCH_INPUT}
      />
    </div>
  );
}

const SEARCH_DEBOUNCE_MS = DURATION_MS.base;

const SEARCH_INPUT =
  "h-9 w-full rounded-md border border-border bg-surface pr-3 pl-9 text-sm text-text outline-none transition-[border-color] duration-(--dur-fast) placeholder:text-muted focus:border-text pointer-coarse:h-11";

function UrlSearchField({
  param,
  placeholder,
  label,
  className,
}: {
  param: string;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlValue = searchParams.get(param) ?? "";
  const [text, setText] = useState(urlValue);
  const [pending, startTransition] = useTransition();
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function onChange(next: string) {
    setText(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      startTransition(() => {
        router.replace(hrefWith(pathname, searchParams, { [param]: next, [PAGE_PARAM]: null }), {
          scroll: false,
        });
      });
    }, SEARCH_DEBOUNCE_MS);
  }

  return (
    <div role="search" className={cn("relative w-full sm:w-[260px]", className)}>
      <Icon
        name="search"
        size={16}
        className={cn(
          "pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted",
          pending && "anim-pulse",
        )}
      />
      <input
        type="search"
        value={text}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        className={SEARCH_INPUT}
      />
    </div>
  );
}

/**
 * Barre de filtres sous l'en-tête (écran 07, y = 109) : recherche optionnelle + filtres.
 * `searchParam` branche le champ sur l'URL. Les filtres défilent seuls sur un écran étroit.
 */
export function FilterBar({
  searchParam,
  searchPlaceholder,
  label = "Filtres",
  className,
  children,
}: {
  searchParam?: string;
  searchPlaceholder?: string;
  label?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("anim-header flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      {searchParam ? <SearchField param={searchParam} placeholder={searchPlaceholder} /> : null}
      {children ? (
        <div
          role="group"
          aria-label={label}
          className="-mx-1 -my-3 flex max-w-full [scrollbar-width:none] items-center gap-2 overflow-x-auto px-1 py-3"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

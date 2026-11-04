"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Field, Input } from "@/components/ui/form";
import { Spinner } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { DURATION_MS } from "@/lib/motion";
import type { CompanyOption } from "../company.lookup";
import { searchCompanyOptionsAction } from "../crm.actions";

/**
 * Choix d'un client par recherche : une `<select>` ne tient pas plusieurs centaines de fiches.
 * Envoie l'identifiant dans un champ caché. N'existait pas dans le kit. La liste s'insère dans le
 * flux : dans une fenêtre, chaque rangée animée forme son propre contexte d'empilement, et une liste
 * flottante passerait sous les boutons de la rangée suivante.
 */
export function CompanyPicker({
  name,
  label,
  hint,
  error,
  initial,
  excludeId,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  initial?: { id: string; name: string } | null;
  excludeId?: string;
  onChange?: (company: { id: string; name: string } | null) => void;
}) {
  const [selected, setSelected] = useState(initial ?? null);
  const [text, setText] = useState(initial?.name ?? "");
  const [results, setResults] = useState<CompanyOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function search(value: string) {
    setText(value);
    setOpen(true);
    setActive(0);
    if (selected) {
      setSelected(null);
      onChange?.(null);
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      startTransition(async () => {
        const options = await searchCompanyOptionsAction(value);
        setResults(options.filter((option) => option.id !== excludeId));
      });
    }, DURATION_MS.fast);
  }

  function choose(option: CompanyOption) {
    const company = { id: option.id, name: option.name };
    setSelected(company);
    setText(option.name);
    setOpen(false);
    onChange?.(company);
  }

  const listId = `${name}-options`;
  return (
    <Field id={`${name}-search`} label={label} hint={hint} error={error}>
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <span className="relative block">
        <Input
          id={`${name}-search`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={text}
          placeholder="Rechercher un client…"
          onFocus={() => {
            if (!selected) search(text);
          }}
          onChange={(event) => search(event.target.value)}
          onBlur={() => window.setTimeout(() => setOpen(false), DURATION_MS.fast)}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              const option = results[active];
              if (option) {
                event.preventDefault();
                choose(option);
              }
            } else if (event.key === "Escape") {
              event.stopPropagation();
              event.preventDefault();
              setOpen(false);
            }
          }}
        />
        {pending ? (
          <Spinner className="absolute top-1/2 right-4 -translate-y-1/2 text-muted" />
        ) : null}
        {open ? (
          <ul
            id={listId}
            role="listbox"
            className="mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-soft"
          >
            {results.length === 0 && !pending ? (
              <li className="px-4 py-2 text-sm text-muted">Aucun client trouvé.</li>
            ) : null}
            {results.map((option, index) => (
              <li
                key={option.id}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
                className={cn(
                  "cursor-pointer px-4 py-2 text-sm text-text",
                  index === active && "bg-surface-raised",
                )}
              >
                {option.name}
              </li>
            ))}
          </ul>
        ) : null}
      </span>
    </Field>
  );
}

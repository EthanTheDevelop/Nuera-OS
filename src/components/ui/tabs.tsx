"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { Replay } from "@/components/motion/page-build";
import { cn } from "@/lib/cn";
import { KpiContent, type NoteTone } from "./kpi-card";

function useTabs(
  ids: readonly string[],
  value: string | undefined,
  defaultValue: string | undefined,
  onChange?: (id: string) => void,
) {
  const [internal, setInternal] = useState(defaultValue ?? ids[0] ?? "");
  const active = value ?? internal;
  const refs = useRef(new Map<string, HTMLElement>());

  function select(id: string) {
    setInternal(id);
    onChange?.(id);
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    const index = ids.indexOf(active);
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % ids.length,
      ArrowLeft: (index - 1 + ids.length) % ids.length,
      Home: 0,
      End: ids.length - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const id = ids[target];
    if (!id) return;
    select(id);
    refs.current.get(id)?.focus();
  }

  return { active, select, onKeyDown, refs };
}

export interface TabItem {
  id: string;
  label: ReactNode;
  content?: ReactNode;
}

/**
 * Onglets soulignés (M4, 141:7352) : actif 14/600 `--text`, trait 2 px qui glisse en 250 ms.
 * Rôles ARIA complets, flèches pour naviguer. `content` peut venir du serveur.
 */
export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  label,
  className,
}: {
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  /** Nom accessible de la liste d'onglets. */
  label: string;
  className?: string;
}) {
  const uid = useId();
  const preset = useMotionPreset();
  const ids = items.map((item) => item.id);
  const { active, select, onKeyDown, refs } = useTabs(ids, value, defaultValue, onValueChange);
  const current = items.find((item) => item.id === active);

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-6 overflow-x-auto border-b border-border"
      >
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(node) => {
                if (node) refs.current.set(item.id, node);
                else refs.current.delete(item.id);
              }}
              id={`${uid}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={item.content !== undefined ? `${uid}-panel-${item.id}` : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(item.id)}
              className={cn(
                "relative shrink-0 pb-2 text-sm whitespace-nowrap outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:py-3",
                selected ? "font-semibold text-text" : "text-muted hover:text-text",
              )}
            >
              {item.label}
              {selected ? (
                <motion.span
                  layoutId={`${uid}-underline`}
                  transition={preset.tab}
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-text"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {current?.content !== undefined ? (
        <div
          id={`${uid}-panel-${current.id}`}
          role="tabpanel"
          aria-labelledby={`${uid}-tab-${current.id}`}
          tabIndex={0}
          className="pt-4 outline-none"
        >
          {current.content}
        </div>
      ) : null}
    </div>
  );
}

export interface KpiTabItem {
  id: string;
  label: ReactNode;
  /** Valeur formatée, ou un `RollingNumber`. */
  value: ReactNode;
  note?: ReactNode;
  noteTone?: NoteTone;
  /** Le contenu piloté par la carte : en général un graphique dans une carte. */
  content: ReactNode;
}

/**
 * Cartes KPI qui sont des onglets (écran 16, motion.md §2.4) : le trait foncé de 3 px glisse sous la
 * carte choisie (250 ms), l'ancien contenu s'efface vers le bas (200 ms), le nouveau se dessine.
 * Le cadre autour du contenu ne bouge pas : `panelClassName` le porte.
 */
export function KpiTabs({
  items,
  value,
  defaultValue,
  onValueChange,
  label,
  panelClassName,
  className,
}: {
  items: readonly KpiTabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  label: string;
  panelClassName?: string;
  className?: string;
}) {
  const uid = useId();
  const preset = useMotionPreset();
  const ids = items.map((item) => item.id);
  const { active, select, onKeyDown, refs } = useTabs(ids, value, defaultValue, onValueChange);
  const current = items.find((item) => item.id === active);

  return (
    <div className={cn("flex flex-col gap-(--grid-gap)", className)}>
      <div className="@container">
        <div
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="grid grid-cols-1 gap-(--grid-gap) @md:grid-cols-2 @4xl:grid-cols-4"
        >
          {items.map((item) => {
            const selected = item.id === active;
            return (
              <button
                key={item.id}
                ref={(node) => {
                  if (node) refs.current.set(item.id, node);
                  else refs.current.delete(item.id);
                }}
                id={`${uid}-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${uid}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(item.id)}
                className="anim-content relative flex min-w-0 flex-col items-start gap-1 rounded-lg bg-surface p-6 text-left shadow-soft transition-shadow duration-(--dur-fast) outline-none hover:shadow-float focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <KpiContent
                  label={item.label}
                  value={item.value}
                  note={item.note}
                  noteTone={item.noteTone}
                />
                {selected ? (
                  <motion.span
                    layoutId={`${uid}-bar`}
                    transition={preset.tab}
                    className="absolute inset-x-6 bottom-0 h-[3px] rounded-t-tab bg-text"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <div
        id={`${uid}-panel`}
        role="tabpanel"
        aria-labelledby={`${uid}-tab-${active}`}
        className={panelClassName}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            initial={preset.swapIn.initial}
            animate={preset.swapIn.animate}
            exit={preset.swapOut}
          >
            <Replay>{current?.content}</Replay>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

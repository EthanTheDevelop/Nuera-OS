"use client";

import { LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import { useToast } from "./toast";

export type KanbanTone = "accent" | "warn" | "success" | "chatgpt" | "danger" | "neutral";

const DOT: Record<KanbanTone, string> = {
  accent: "bg-accent",
  warn: "bg-warn",
  success: "bg-success",
  chatgpt: "bg-chatgpt",
  danger: "bg-danger",
  neutral: "bg-muted",
};

export interface KanbanColumnDef {
  id: string;
  title: string;
  tone?: KanbanTone;
  /** Lien « + Ajouter » en bas de colonne. */
  addHref?: string;
  addLabel?: string;
  /** Une carte ne peut pas arriver ici (transition interdite, colonne d'arrivée). */
  dropDisabled?: boolean;
}

export interface KanbanItem {
  id: string;
  columnId: string;
  /** Nom annoncé pendant un déplacement au clavier. */
  label: string;
  /** Le contenu de la carte, en général un `KanbanCard`. Peut être rendu par le serveur. */
  card: ReactNode;
}

export interface KanbanMove {
  itemId: string;
  toColumnId: string;
  toIndex: number;
}

type MoveResult = void | { status: string; message?: string };

const DRAG_THRESHOLD_PX = 5;
const AUTO_SCROLL_EDGE_PX = 48;
const AUTO_SCROLL_STEP_PX = 14;

function move(items: readonly KanbanItem[], { itemId, toColumnId, toIndex }: KanbanMove) {
  const moved = items.find((item) => item.id === itemId);
  if (!moved) return [...items];
  const rest = items.filter((item) => item.id !== itemId);
  const inTarget = rest.filter((item) => item.columnId === toColumnId);
  const anchor = inTarget[toIndex];
  const updated = { ...moved, columnId: toColumnId };
  if (!anchor) {
    const lastOfColumn = rest.reduce(
      (found, item, index) => (item.columnId === toColumnId ? index : found),
      -1,
    );
    if (lastOfColumn === -1) return [...rest, updated];
    return [...rest.slice(0, lastOfColumn + 1), updated, ...rest.slice(lastOfColumn + 1)];
  }
  const at = rest.indexOf(anchor);
  return [...rest.slice(0, at), updated, ...rest.slice(at)];
}

/**
 * Tableau Kanban (écrans 03, 11), glisser-déposer réel, souris, tactile et clavier, sans
 * bibliothèque : événements `pointer` natifs.
 *
 * - Souris : glisser la carte. Le clic simple garde le lien de la carte.
 * - Tactile : glisser depuis la poignée de la carte ; le reste de la carte fait défiler la page.
 * - Clavier : Espace sur une carte pour la prendre, flèches pour la déplacer, Espace pour poser,
 *   Échap pour annuler. Chaque étape est annoncée aux lecteurs d'écran.
 *
 * `onMove` : Server Action ou fonction, appelée à la pose. L'affichage suit tout de suite et revient
 * en arrière si elle échoue (rejet, ou `ActionState` en erreur, dont le message s'affiche).
 * Passer une nouvelle liste `items` réinitialise le tableau.
 */
export function KanbanBoard({
  columns,
  items,
  onMove,
  label,
  className,
}: {
  columns: readonly KanbanColumnDef[];
  items: readonly KanbanItem[];
  onMove: (move: KanbanMove) => MoveResult | Promise<MoveResult>;
  /** Nom accessible du tableau. */
  label: string;
  className?: string;
}) {
  const [board, setBoard] = useState(items);
  const [source, setSource] = useState(items);
  if (source !== items) {
    setSource(items);
    setBoard(items);
  }

  const toast = useToast();
  const preset = useMotionPreset();
  const boardRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const beforeLift = useRef<readonly KanbanItem[] | null>(null);
  const lastPointerDrag = useRef(0);

  const columnTitle = useCallback(
    (id: string) => columns.find((column) => column.id === id)?.title ?? id,
    [columns],
  );

  const inColumn = useCallback(
    (list: readonly KanbanItem[], columnId: string) =>
      list.filter((item) => item.columnId === columnId),
    [],
  );

  const commit = useCallback(
    async (next: readonly KanbanItem[], previous: readonly KanbanItem[], itemId: string) => {
      const item = next.find((entry) => entry.id === itemId);
      const before = previous.find((entry) => entry.id === itemId);
      if (!item || !before) return;
      const toIndex = inColumn(next, item.columnId).indexOf(item);
      const unchanged =
        before.columnId === item.columnId &&
        inColumn(previous, before.columnId).indexOf(before) === toIndex;
      if (unchanged) return;
      try {
        const result = await onMove({ itemId, toColumnId: item.columnId, toIndex });
        if (result && result.status === "error") {
          setBoard(previous);
          if (result.message) toast({ message: result.message, tone: "danger" });
        }
      } catch {
        setBoard(previous);
        toast({ message: "Le déplacement a échoué : la carte a repris sa place.", tone: "danger" });
      }
    },
    [inColumn, onMove, toast],
  );

  /* ---- Glisser à la souris ou au doigt ---- */

  const startPointerDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, itemId: string, element: HTMLElement) => {
      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      const rect = element.getBoundingClientRect();
      const previous = board;
      let current = board;
      let ghost: HTMLElement | null = null;
      let frame = 0;
      let lastX = startX;
      let lastY = startY;

      const hitTest = () => {
        const target = document
          .elementsFromPoint(lastX, lastY)
          .find(
            (node) => node instanceof HTMLElement && node.dataset.kanbanColumn !== undefined,
          ) as HTMLElement | undefined;
        const columnId = target?.dataset.kanbanColumn;
        if (!target || !columnId) return;
        if (columns.find((column) => column.id === columnId)?.dropDisabled) return;
        const cards = [...target.querySelectorAll<HTMLElement>("[data-kanban-item]")].filter(
          (node) => node.dataset.kanbanItem !== itemId,
        );
        const toIndex = cards.filter((node) => {
          const box = node.getBoundingClientRect();
          return box.top + box.height / 2 < lastY;
        }).length;
        const next = move(current, { itemId, toColumnId: columnId, toIndex });
        const moved = next.findIndex((item) => item.id === itemId);
        const was = current.findIndex((item) => item.id === itemId);
        if (moved !== was || next[moved]?.columnId !== current[was]?.columnId) {
          current = next;
          setBoard(next);
        }
      };

      const tick = () => {
        const scroller = boardRef.current;
        if (scroller) {
          const box = scroller.getBoundingClientRect();
          if (lastX > box.right - AUTO_SCROLL_EDGE_PX) scroller.scrollLeft += AUTO_SCROLL_STEP_PX;
          else if (lastX < box.left + AUTO_SCROLL_EDGE_PX)
            scroller.scrollLeft -= AUTO_SCROLL_STEP_PX;
        }
        hitTest();
        frame = requestAnimationFrame(tick);
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        if (!ghost) {
          if (Math.hypot(lastX - startX, lastY - startY) < DRAG_THRESHOLD_PX) return;
          ghost = element.cloneNode(true) as HTMLElement;
          ghost.setAttribute("aria-hidden", "true");
          ghost.removeAttribute("data-kanban-item");
          ghost.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;margin:0;z-index:60;pointer-events:none;box-shadow:var(--shadow-float);rotate:1.5deg;`;
          document.body.appendChild(ghost);
          setDraggingId(itemId);
          document.documentElement.style.cursor = "grabbing";
          frame = requestAnimationFrame(tick);
        }
        ghost.style.transform = `translate(${lastX - startX}px, ${lastY - startY}px)`;
      };

      const finish = (cancelled: boolean) => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        window.removeEventListener("keydown", onKeyDown, true);
        cancelAnimationFrame(frame);
        document.documentElement.style.cursor = "";
        if (!ghost) return;
        ghost.remove();
        ghost = null;
        setDraggingId(null);
        lastPointerDrag.current = performance.now();
        if (cancelled) {
          setBoard(previous);
          return;
        }
        void commit(current, previous, itemId);
      };
      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId === pointerId) finish(false);
      };
      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === pointerId) finish(true);
      };
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          finish(true);
        }
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      window.addEventListener("keydown", onKeyDown, true);
    },
    [board, columns, commit],
  );

  /* ---- Clavier ---- */

  const refocus = useCallback((itemId: string) => {
    requestAnimationFrame(() => {
      boardRef.current
        ?.querySelector<HTMLElement>(`[data-kanban-item="${CSS.escape(itemId)}"]`)
        ?.focus({ preventScroll: false });
    });
  }, []);

  function onCardKeyDown(event: ReactKeyboardEvent<HTMLElement>, item: KanbanItem) {
    if (event.target !== event.currentTarget) return;
    const lifted = liftedId === item.id;

    if (event.key === " " || (event.key === "Enter" && lifted)) {
      event.preventDefault();
      if (lifted) {
        const previous = beforeLift.current ?? board;
        setLiftedId(null);
        beforeLift.current = null;
        setAnnouncement(`${item.label} posée dans ${columnTitle(item.columnId)}.`);
        void commit(board, previous, item.id);
      } else {
        beforeLift.current = board;
        setLiftedId(item.id);
        setAnnouncement(
          `${item.label} prise, colonne ${columnTitle(item.columnId)}. Flèches pour déplacer, Espace pour poser, Échap pour annuler.`,
        );
      }
      return;
    }

    if (!lifted) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setBoard(beforeLift.current ?? board);
      beforeLift.current = null;
      setLiftedId(null);
      setAnnouncement(`Déplacement de ${item.label} annulé.`);
      refocus(item.id);
      return;
    }

    const columnIndex = columns.findIndex((column) => column.id === item.columnId);
    const inCurrent = inColumn(board, item.columnId);
    const position = inCurrent.indexOf(item);
    let target: KanbanMove | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const step = event.key === "ArrowRight" ? 1 : -1;
      let next = columnIndex + step;
      while (columns[next]?.dropDisabled) next += step;
      const column = columns[next];
      if (column) {
        const size = inColumn(board, column.id).length;
        target = { itemId: item.id, toColumnId: column.id, toIndex: Math.min(position, size) };
      }
    } else if (event.key === "ArrowUp" && position > 0) {
      target = { itemId: item.id, toColumnId: item.columnId, toIndex: position - 1 };
    } else if (event.key === "ArrowDown" && position < inCurrent.length - 1) {
      target = { itemId: item.id, toColumnId: item.columnId, toIndex: position + 1 };
    }

    if (event.key.startsWith("Arrow")) event.preventDefault();
    if (!target) return;
    setBoard(move(board, target));
    setAnnouncement(`${columnTitle(target.toColumnId)}, position ${target.toIndex + 1}.`);
    refocus(item.id);
  }

  // Une carte prise au clavier est relâchée si le tableau perd le focus.
  useEffect(() => {
    if (!liftedId) return;
    const element = boardRef.current;
    const onFocusOut = (event: FocusEvent) => {
      if (element?.contains(event.relatedTarget as Node | null)) return;
      if (event.relatedTarget === null) return; // Remontage de la carte : le focus revient.
      if (beforeLift.current) setBoard(beforeLift.current);
      beforeLift.current = null;
      setLiftedId(null);
    };
    element?.addEventListener("focusout", onFocusOut);
    return () => element?.removeEventListener("focusout", onFocusOut);
  }, [liftedId]);

  return (
    <LayoutGroup>
      <div
        ref={boardRef}
        role="group"
        aria-label={label}
        aria-roledescription="tableau Kanban"
        className={cn(
          // `relative` : les textes `sr-only` des colonnes restent dans la zone qui défile.
          "relative flex snap-x [scrollbar-width:thin] items-start gap-(--grid-gap) overflow-x-auto pb-4 sm:snap-none",
          className,
        )}
      >
        {columns.map((column, columnIndex) => {
          const cards = inColumn(board, column.id);
          return (
            <section
              key={column.id}
              aria-labelledby={`kanban-${column.id}`}
              data-kanban-column={column.id}
              style={{ "--i": columnIndex } as CSSProperties}
              className="anim-content flex w-[min(280px,82vw)] shrink-0 snap-start flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 sm:w-auto sm:min-w-[206px] sm:flex-1"
            >
              <header className="flex items-center gap-2 px-1">
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-full", DOT[column.tone ?? "accent"])}
                />
                <h3
                  id={`kanban-${column.id}`}
                  className="min-w-0 flex-1 truncate text-tile-title text-ink"
                >
                  {column.title}
                </h3>
                <span className="tabular font-mono text-xs leading-[1.25] font-medium text-muted">
                  {cards.length}
                  <span className="sr-only"> carte{cards.length > 1 ? "s" : ""}</span>
                </span>
              </header>
              <ul className="flex min-h-12 flex-col gap-3">
                {cards.map((item) => {
                  const lifted = liftedId === item.id;
                  const dragging = draggingId === item.id;
                  return (
                    <motion.li
                      key={item.id}
                      layout="position"
                      layoutId={`kanban-card-${item.id}`}
                      transition={preset.move}
                      data-kanban-item={item.id}
                      tabIndex={0}
                      aria-roledescription="carte déplaçable"
                      aria-label={item.label}
                      aria-pressed={lifted || undefined}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || event.pointerType === "touch") return;
                        startPointerDrag(event, item.id, event.currentTarget);
                      }}
                      onClickCapture={(event) => {
                        // Le relâchement d'un glissé ne doit pas suivre le lien de la carte.
                        if (performance.now() - lastPointerDrag.current < 200) {
                          event.preventDefault();
                          event.stopPropagation();
                        }
                      }}
                      onKeyDown={(event) => onCardKeyDown(event, item)}
                      className={cn(
                        "group/card relative cursor-grab rounded-md outline-none select-none active:cursor-grabbing",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                        dragging && "opacity-40",
                        lifted && "z-10 shadow-float outline-2 outline-offset-2 outline-accent",
                      )}
                    >
                      {item.card}
                      {/* Le doigt fait défiler la page : il glisse depuis cette poignée. */}
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        onPointerDown={(event) => {
                          if (event.pointerType !== "touch") return;
                          event.stopPropagation();
                          const card =
                            event.currentTarget.closest<HTMLElement>("[data-kanban-item]");
                          if (card) startPointerDrag(event, item.id, card);
                        }}
                        className="absolute top-1 right-1 hidden size-9 touch-none items-center justify-center rounded-sm text-muted pointer-coarse:flex"
                      >
                        <Icon name="reglages" size={14} className="rotate-90" />
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
              {column.addHref ? (
                <Link
                  href={column.addHref}
                  className="hit-44 flex items-center gap-1 self-start rounded-sm py-2 pl-2 text-cell font-medium text-muted hover:text-text"
                >
                  <Icon name="plus" size={14} />
                  {column.addLabel ?? "Ajouter"}
                </Link>
              ) : null}
            </section>
          );
        })}
      </div>
      <p aria-live="assertive" className="sr-only">
        {announcement}
      </p>
    </LayoutGroup>
  );
}

/**
 * Carte Kanban (Figma 65:689) : bordure, rayon 12, `padding 16`, gap 8.
 * `href` : toute la carte mène à la fiche. Le reste compose librement (montant, avatar, badges).
 */
export function KanbanCard({
  title,
  subtitle,
  href,
  className,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  href?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border bg-surface p-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-row-primary text-text">
          {href ? (
            <Link
              href={href}
              draggable={false}
              className="after:absolute after:inset-0 after:rounded-md"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </p>
        {subtitle ? <p className="truncate text-row-secondary text-muted">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { staggerIndex } from "@/components/motion/stagger";
import { EmptyState } from "@/components/states/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  AddTile,
  Tile,
  TILE_GRID,
  TILE_SPAN_CLASSES,
  TileRemoveButton,
  TileResizeHandle,
  TileSlot,
} from "@/components/ui/tile";
import { useToast } from "@/components/ui/toast";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { DURATION_MS, EASE } from "@/lib/motion";
import { saveDashboardLayoutAction } from "../dashboard.actions";
import {
  closestInsertion,
  emptyCells,
  insertTile,
  moveTile,
  nearestTileSize,
  packTiles,
  stepTileSize,
  TILE_CATALOG,
  tileDefinition,
  tileSpan,
  type DashboardTileSize,
  type LayoutTile,
  type TileDefinition,
  type TileKey,
  type TilePlacement,
} from "../dashboard.tiles";
import type { DashboardData, TileState } from "../dashboard.types";
import { tileBadge, TileBody } from "./tile-body";

/** Hauteur minimale d'une rangée, celle de `TILE_GRID`. */
const ROW_MIN_PX = 168;
/** En deçà de ce déplacement, un appui reste un clic. */
const DRAG_THRESHOLD_PX = 4;
/** Le tableau se réarrange au plus à ce rythme : pas de va-et-vient pendant un survol rapide. */
const REFLOW_COOLDOWN_MS = 120;
/** Près du bord de la fenêtre, la page défile, jusqu'à cette vitesse par image. */
const SCROLL_EDGE_PX = 64;
const SCROLL_MAX_PX = 14;
const REFLOW_EASING = `cubic-bezier(${EASE.emphasis.join(",")})`;

/** Geste en cours : la grille passe en placement explicite et montre ses emplacements. */
type BoardGesture = {
  kind: "move" | "add" | "resize";
  key: TileKey;
  columns: number;
  /** Ordre du DOM figé pendant le geste : déplacer un nœud lui ferait perdre le pointeur. */
  domKeys: TileKey[];
  /** Rang visé par une tuile venue de la galerie, tant qu'elle survole le tableau. */
  at: number | null;
  outside: boolean;
  ghost: { width: number; height: number; x: number; y: number } | null;
};

const placementStyle = (
  placement: Pick<TilePlacement, "column" | "row"> & Partial<TilePlacement>,
) =>
  ({
    gridColumn: `${placement.column} / span ${placement.columns ?? 1}`,
    gridRow: `${placement.row} / span ${placement.rows ?? 1}`,
  }) satisfies CSSProperties;

/** Pistes réelles de la grille : les rangées grandissent avec leur contenu. */
function measureGrid(grid: HTMLElement) {
  const styles = getComputedStyle(grid);
  const tracks = (value: string) => value.split(" ").map(Number.parseFloat).filter(Number.isFinite);
  const columns = tracks(styles.gridTemplateColumns);
  return {
    rect: grid.getBoundingClientRect(),
    gap: Number.parseFloat(styles.columnGap) || 0,
    columns: columns.length,
    columnWidth: columns[0] ?? 0,
    rows: tracks(styles.gridTemplateRows),
  };
}

/** Case de la grille sous un point de l'écran, fractions comprises (à partir de 1). */
function cellAt(metrics: ReturnType<typeof measureGrid>, x: number, y: number) {
  const column = (x - metrics.rect.left) / (metrics.columnWidth + metrics.gap) + 1;
  let rest = y - metrics.rect.top;
  let row = 1;
  for (const height of metrics.rows) {
    const track = height + metrics.gap;
    if (rest < track) return { column, row: row + rest / track };
    rest -= track;
    row += 1;
  }
  return { column, row: row + rest / (ROW_MIN_PX + metrics.gap) };
}

function isInside(box: DOMRect | undefined, x: number, y: number, margin = 0) {
  return (
    !!box &&
    x >= box.left - margin &&
    x <= box.right + margin &&
    y >= box.top - margin &&
    y <= box.bottom + margin
  );
}

const sizeLabel = (size: DashboardTileSize) => size.replace("x", "×");

/** Flèches sur la poignée : la droite et le bas agrandissent, comme en la tirant, un côté à la fois. */
const ARROW_STEP: Partial<Record<string, { axis: "columns" | "rows"; step: -1 | 1 }>> = {
  ArrowLeft: { axis: "columns", step: -1 },
  ArrowRight: { axis: "columns", step: 1 },
  ArrowUp: { axis: "rows", step: -1 },
  ArrowDown: { axis: "rows", step: 1 },
};

/**
 * Dès qu'on touche au tableau, la page est construite : une tuile ajoutée ou un chiffre qui change de
 * format s'affiche aussitôt, sans rejouer le délai d'arrivée (réaction : 150 ms au plus).
 */
function settlePageBuild() {
  document.documentElement.toggleAttribute("data-page-seen", true);
}

/** Réseau coupé : l'appel lève côté navigateur. Le tableau en cours d'édition ne doit pas se perdre. */
async function saveLayout(tiles: LayoutTile[]): Promise<ActionState> {
  try {
    return await saveDashboardLayoutAction({ tiles });
  } catch {
    return {
      status: "error",
      message: "Enregistrement impossible. Vérifiez votre connexion, puis réessayez.",
    };
  }
}

/**
 * Poignée de taille : suit le pointeur, souris ou doigt, et propose le format le plus proche à chaque
 * mouvement. Le calcul part de la mesure au départ du geste : une tuile que la grille replace pendant
 * l'aperçu ne fait pas sauter le format. Un cadre suit le pointeur au pixel, la tuile se cale sur le
 * format proposé. Sans déplacement, un clic ne change rien. Échap annule.
 */
function BoardResizeHandle({
  item,
  label,
  onBegin,
  onPreview,
  onCommit,
  onEnd,
}: {
  item: LayoutTile;
  label: string;
  onBegin: (key: TileKey) => void;
  onPreview: (key: TileKey, size: DashboardTileSize) => void;
  onCommit: (key: TileKey, size: DashboardTileSize) => void;
  onEnd: () => void;
}) {
  const band = useRef<HTMLSpanElement>(null);
  const gesture = useRef<{
    began: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    gap: number;
    gridColumns: number;
    columnTrack: number;
    rowTrack: number;
    start: DashboardTileSize;
    last: DashboardTileSize;
  } | null>(null);

  function start(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const host = event.currentTarget.closest<HTMLElement>("[data-tile-key]");
    const grid = host?.parentElement;
    if (!host || !grid) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const styles = getComputedStyle(grid);
    const gap = Number.parseFloat(styles.columnGap) || 0;
    const gridColumns = styles.gridTemplateColumns.split(" ").length;
    const span = tileSpan(item.size, gridColumns);
    const { width, height } = host.getBoundingClientRect();
    gesture.current = {
      began: false,
      x: event.pageX,
      y: event.pageY,
      width,
      height,
      gap,
      gridColumns,
      columnTrack: (width + gap) / span.columns,
      rowTrack: (height + gap) / span.rows,
      start: item.size,
      last: item.size,
    };
  }

  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = gesture.current;
    if (!drag) return;
    const dx = event.pageX - drag.x;
    const dy = event.pageY - drag.y;
    if (!drag.began) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.began = true;
      onBegin(item.key);
      if (band.current) band.current.hidden = false;
    }
    if (band.current) {
      band.current.style.width = `${Math.max(drag.width + dx, drag.columnTrack / 2)}px`;
      band.current.style.height = `${Math.max(drag.height + dy, drag.rowTrack / 2)}px`;
    }
    const size = nearestTileSize(
      drag.last,
      {
        columns: (drag.width + dx + drag.gap) / drag.columnTrack,
        rows: (drag.height + dy + drag.gap) / drag.rowTrack,
      },
      drag.gridColumns,
    );
    if (size === drag.last) return;
    drag.last = size;
    onPreview(item.key, size);
  }

  function release() {
    const drag = gesture.current;
    gesture.current = null;
    if (band.current) band.current.hidden = true;
    if (drag?.began) onEnd();
    return drag;
  }

  function end() {
    const drag = release();
    if (drag && drag.last !== drag.start) onCommit(item.key, drag.last);
  }

  function cancel() {
    const drag = release();
    if (drag && drag.last !== drag.start) onPreview(item.key, drag.start);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      cancel();
      return;
    }
    const arrow = ARROW_STEP[event.key];
    if (!arrow) return;
    event.preventDefault();
    const size = stepTileSize(item.size, arrow.axis, arrow.step);
    if (size !== item.size) onCommit(item.key, size);
  }

  return (
    <>
      <span
        ref={band}
        hidden
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 z-20 rounded-xl border-2 border-accent bg-accent-pale/30"
      />
      <TileResizeHandle
        tileName={`${label}, format ${sizeLabel(item.size)}. Glissez, ou utilisez les flèches`}
        editing
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancel}
        onKeyDown={onKeyDown}
      />
    </>
  );
}

function BoardTile({
  item,
  position,
  count,
  state,
  editing,
  placement,
  active,
  onResizeBegin,
  onResizePreview,
  onResizeCommit,
  onResizeEnd,
  onRemove,
  onMove,
  onDragStart,
}: {
  item: LayoutTile;
  position: number;
  count: number;
  state: TileState | undefined;
  editing: boolean;
  placement: TilePlacement | undefined;
  /** Tuile du geste en cours : déplacée, elle suit le pointeur ; redimensionnée, elle est soulignée. */
  active: "move" | "resize" | null;
  onResizeBegin: (key: TileKey) => void;
  onResizePreview: (key: TileKey, size: DashboardTileSize) => void;
  onResizeCommit: (key: TileKey, size: DashboardTileSize) => void;
  onResizeEnd: () => void;
  onRemove: (key: TileKey) => void;
  onMove: (key: TileKey, to: number) => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>, key: TileKey) => void;
}) {
  const definition = tileDefinition(item.key);
  const title = (state?.status === "ready" ? state.view.title : undefined) ?? definition.title;

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!editing || event.target !== event.currentTarget) return;
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (step) {
      event.preventDefault();
      onMove(item.key, position + step);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemove(item.key);
    }
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!editing) return;
    const target = event.target as HTMLElement;
    // Au doigt, seule la poignée dédiée déplace : le reste de la tuile laisse défiler la page.
    if (event.pointerType === "touch" && !target.closest("[data-tile-grip]")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (target.closest("button,a")) return;
    onDragStart(event, item.key);
  }

  return (
    <div
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      data-tile-key={item.key}
      tabIndex={editing ? 0 : undefined}
      aria-label={
        editing
          ? `${title}, position ${position + 1} sur ${count}. Flèches pour déplacer, Suppr pour retirer.`
          : undefined
      }
      role={editing ? "group" : undefined}
      style={{ ...staggerIndex(position), ...(placement ? placementStyle(placement) : null) }}
      className={cn(
        "relative min-w-0 rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        TILE_SPAN_CLASSES[item.size],
        editing && "cursor-grab select-none",
        active === "move" && "z-20 cursor-grabbing opacity-95 [&>article]:shadow-float",
        active === "resize" && "z-20 ring-4 ring-accent/40",
      )}
    >
      <Tile
        icon={definition.icon}
        title={title}
        aside={tileBadge(state)}
        href={editing ? undefined : (definition.href ?? undefined)}
        editing={editing}
        fit
        className="h-full"
        handle={
          editing ? (
            <BoardResizeHandle
              item={item}
              label={title}
              onBegin={onResizeBegin}
              onPreview={onResizePreview}
              onCommit={onResizeCommit}
              onEnd={onResizeEnd}
            />
          ) : null
        }
        removeControl={
          editing ? (
            <>
              <TileRemoveButton tileName={title} onClick={() => onRemove(item.key)} />
              <div
                role="presentation"
                data-tile-grip
                className="absolute top-1 right-1 z-10 hidden size-8 touch-none items-center justify-center rounded-full text-muted pointer-coarse:flex"
              >
                <Icon name="menu" size={16} />
              </div>
            </>
          ) : null
        }
      >
        {/* Le cadre et le titre d'abord, le contenu ensuite (note M1). */}
        <div className="anim-data tile-body">
          <TileBody state={state} size={item.size} editing={editing} service={definition.title} />
        </div>
      </Tile>
    </div>
  );
}

function GalleryItem({
  definition,
  onAdd,
  onDragStart,
}: {
  definition: TileDefinition;
  onAdd: (key: TileKey) => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>, key: TileKey, onActive: () => void) => void;
}) {
  const dragged = useRef(false);
  return (
    <button
      type="button"
      data-gallery-item
      onPointerDown={(event) => {
        dragged.current = false;
        // Au doigt, la liste défile : on y ajoute au toucher.
        if (event.pointerType === "touch") return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        onDragStart(event, definition.key, () => {
          dragged.current = true;
        });
      }}
      onClick={(event) => {
        // Le clic du relâchement n'est pas un ajout : c'est le dépôt qui décide. Au clavier, toujours.
        if (event.detail === 0 || !dragged.current) onAdd(definition.key);
      }}
      className="relative flex h-[46px] w-full shrink-0 cursor-grab items-center gap-3 rounded-sm border border-border bg-surface px-2 text-left text-sm font-medium text-ink transition-colors duration-(--dur-fast) hover:bg-accent-pale/40 lg:touch-none"
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-accent-pale text-accent"
      >
        <Icon name="plus" size={16} />
      </span>
      <span className="min-w-0 flex-1 truncate">{definition.title}</span>
      <span className="shrink-0 font-mono text-table-head font-normal text-muted">
        {sizeLabel(definition.size)}
      </span>
    </button>
  );
}

/**
 * Tableau de bord (écrans 01 et 06). La poignée n'existe qu'en édition, où rien n'est enregistré
 * avant « Terminé » : le serveur valide, « Annuler » abandonne. Le panneau de la galerie flotte
 * au-dessus du tableau sans le déplacer, se réduit, et s'efface pendant un geste. La grille montre
 * alors ses emplacements libres et celui où la tuile va se poser, comme l'écran d'accueil d'iOS.
 */
export function DashboardBoard({ data, editing }: { data: DashboardData; editing: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const galleryId = useId();
  const [galleryOpen, setGalleryOpen] = useState(true);
  const [tiles, setTiles] = useState<LayoutTile[]>(data.layout.tiles);
  const [announce, setAnnounce] = useState("");
  const [gesture, setGesture] = useState<BoardGesture | null>(null);
  const [saving, startSaving] = useTransition();
  const { reduced } = useMotionPreset();
  const panel = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  /** Pose la tuile déplacée sous le pointeur, une fois la grille réarrangée. */
  const placeDragged = useRef<(() => void) | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const lastWidth = useRef(0);
  const noFlip = useRef<TileKey | null>(null);

  const available = useMemo(() => {
    const allowed = new Set([...data.layout.tiles, ...data.gallery].map((tile) => tile.key));
    const placed = new Set(tiles.map((tile) => tile.key));
    return TILE_CATALOG.filter(({ key }) => allowed.has(key) && !placed.has(key));
  }, [data, tiles]);

  // Le focus du clavier survit à ce qui vient de quitter le DOM : tuile retirée, entrée de galerie.
  const pendingFocus = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => {
    const target = pendingFocus.current?.();
    pendingFocus.current = null;
    target?.focus();
  }, [tiles]);

  useEffect(() => () => stopDrag.current?.(), []);

  // Réarrangement : chaque tuile part d'où elle était et rejoint sa place, sans animation en mouvement
  // réduit. `offsetLeft` ignore les transformations : une animation interrompue repart d'où elle en est.
  useLayoutEffect(() => {
    const board = grid.current;
    if (!board) return;
    placeDragged.current?.();
    const animated = !reduced && board.offsetWidth === lastWidth.current;
    const origin = board.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();
    for (const element of board.querySelectorAll<HTMLElement>(
      "[data-tile-key],[data-slot-landing]",
    )) {
      const id = element.dataset.tileKey ?? "landing";
      const x = element.offsetLeft;
      const y = element.offsetTop;
      next.set(id, { x, y });
      const before = positions.current.get(id);
      if (!animated || !before || id === noFlip.current) continue;
      const box = element.getBoundingClientRect();
      const dx = before.x - x + (box.left - origin.left - x);
      const dy = before.y - y + (box.top - origin.top - y);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      element.getAnimations().forEach((animation) => animation.cancel());
      element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: DURATION_MS.move,
        easing: REFLOW_EASING,
      });
    }
    positions.current = next;
    lastWidth.current = board.offsetWidth;
    if (!gesture) noFlip.current = null;
  }, [tiles, gesture, reduced]);

  function previewSize(key: TileKey, size: DashboardTileSize) {
    settlePageBuild();
    setTiles((current) => current.map((tile) => (tile.key === key ? { ...tile, size } : tile)));
  }

  function commitSize(key: TileKey, size: DashboardTileSize) {
    previewSize(key, size);
    setAnnounce(`${tileDefinition(key).title} : format ${sizeLabel(size)}.`);
  }

  function removeTile(key: TileKey) {
    const index = tiles.findIndex((tile) => tile.key === key);
    const neighbour = tiles[index + 1] ?? tiles[index - 1];
    pendingFocus.current = () =>
      neighbour
        ? document.querySelector<HTMLElement>(`[data-tile-key="${neighbour.key}"]`)
        : panel.current?.querySelector("button");
    setTiles((current) => current.filter((tile) => tile.key !== key));
    setAnnounce(`${tileDefinition(key).title} retirée du tableau.`);
  }

  function addTile(key: TileKey, at?: number) {
    settlePageBuild();
    const { size } = tileDefinition(key);
    const place = available.findIndex((definition) => definition.key === key);
    pendingFocus.current = () => {
      const entries = panel.current?.querySelectorAll<HTMLElement>("[data-gallery-item]");
      return (
        entries?.[Math.min(place, entries.length - 1)] ??
        document.querySelector<HTMLElement>(`[data-tile-key="${key}"]`)
      );
    };
    setTiles((current) => {
      if (current.some((tile) => tile.key === key)) return current;
      const next = [...current];
      next.splice(at ?? next.length, 0, { key, size });
      return next;
    });
    setAnnounce(`${tileDefinition(key).title} ajoutée au tableau.`);
  }

  function moveByKeyboard(key: TileKey, to: number) {
    const target = Math.max(0, Math.min(tiles.length - 1, to));
    setTiles(moveTile(tiles, key, target));
    setAnnounce(`${tileDefinition(key).title} : position ${target + 1} sur ${tiles.length}.`);
  }

  /**
   * Glisser une tuile du tableau ou de la galerie, souris ou doigt. L'écoute se fait sur la fenêtre et
   * la boucle d'images fait le reste : suivre le pointeur, faire défiler près des bords, réarranger.
   * Lâchée hors du tableau, ou sur Échap, la tuile revient d'où elle venait.
   */
  function beginDrag(event: ReactPointerEvent<HTMLElement>, key: TileKey, onActive?: () => void) {
    const board = grid.current;
    if (!board || stopDrag.current) return;
    const { pointerId } = event;
    const start = { x: event.clientX, y: event.clientY };
    const origin = tiles;
    const placed = tiles.find((tile) => tile.key === key);
    const tile = placed ?? { key, size: tileDefinition(key).size };
    const others = tiles.filter((other) => other.key !== key);
    const host = placed ? board.querySelector<HTMLElement>(`[data-tile-key="${key}"]`) : null;
    const hostBox = host?.getBoundingClientRect();
    const session = {
      active: false,
      pointer: start,
      grab: hostBox ? { x: start.x - hostBox.left, y: start.y - hostBox.top } : { x: 0, y: 0 },
      at: placed ? tiles.indexOf(placed) : (null as number | null),
      outside: false,
      dirty: false,
      lastReflow: 0,
      frame: 0,
    };

    const place = () => {
      const x = session.pointer.x - session.grab.x;
      const y = session.pointer.y - session.grab.y;
      if (ghost.current) ghost.current.style.transform = `translate(${x}px, ${y}px)`;
      if (host) {
        const box = board.getBoundingClientRect();
        host.style.transform = `translate(${x - box.left - host.offsetLeft}px, ${y - box.top - host.offsetTop}px)`;
      }
    };

    const reflow = () => {
      session.dirty = false;
      session.lastReflow = performance.now();
      const metrics = measureGrid(board);
      const { x, y } = session.pointer;
      const outside = !isInside(metrics.rect, x, y, metrics.gap);
      let at: number | null = null;
      if (!outside) {
        const target = cellAt(metrics, x - session.grab.x, y - session.grab.y);
        at = closestInsertion(others, tile, target, metrics.columns, session.at);
      }
      if (at === session.at && outside === session.outside) return;
      session.at = at;
      session.outside = outside;
      if (placed) setTiles(at === null ? origin : insertTile(others, tile, at));
      setGesture((current) => current && { ...current, at, outside });
    };

    const tick = () => {
      const { y } = session.pointer;
      const edge =
        y < SCROLL_EDGE_PX ? y - SCROLL_EDGE_PX : y - (window.innerHeight - SCROLL_EDGE_PX);
      if ((y < SCROLL_EDGE_PX || y > window.innerHeight - SCROLL_EDGE_PX) && session.active) {
        const speed = Math.min(SCROLL_MAX_PX, Math.abs(edge) / 4);
        window.scrollBy({ top: Math.sign(edge) * speed, behavior: "instant" });
        session.dirty = true;
      }
      place();
      if (session.dirty && performance.now() - session.lastReflow >= REFLOW_COOLDOWN_MS) reflow();
      session.frame = requestAnimationFrame(tick);
    };

    const activate = () => {
      session.active = true;
      onActive?.();
      settlePageBuild();
      noFlip.current = key;
      const metrics = measureGrid(board);
      const span = tileSpan(tile.size, metrics.columns);
      let preview: BoardGesture["ghost"] = null;
      if (!placed) {
        const width = span.columns * (metrics.columnWidth + metrics.gap) - metrics.gap;
        session.grab = { x: Math.min(width / 2, 80), y: 28 };
        session.at = null;
        session.outside = true;
        preview = {
          width,
          height: span.rows * (ROW_MIN_PX + metrics.gap) - metrics.gap,
          x: session.pointer.x - session.grab.x,
          y: session.pointer.y - session.grab.y,
        };
      }
      placeDragged.current = place;
      setGesture({
        kind: placed ? "move" : "add",
        key,
        columns: metrics.columns,
        domKeys: tiles.map((item) => item.key),
        at: session.at,
        outside: session.outside,
        ghost: preview,
      });
      session.dirty = true;
      session.frame = requestAnimationFrame(tick);
    };

    const onMove = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      session.pointer = { x: next.clientX, y: next.clientY };
      if (session.active) session.dirty = true;
      else if (Math.hypot(next.clientX - start.x, next.clientY - start.y) >= DRAG_THRESHOLD_PX) {
        activate();
      }
    };

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(session.frame);
      placeDragged.current = null;
      stopDrag.current = null;
    };

    /** La tuile lâchée glisse jusqu'à sa place, au-dessus des autres, sauf en mouvement réduit. */
    const settle = () => {
      if (!host) return;
      const from = host.style.transform;
      host.style.transform = "";
      if (reduced || !from) return;
      host.animate(
        [
          { transform: from, zIndex: 20 },
          { transform: "none", zIndex: 20 },
        ],
        { duration: DURATION_MS.move, easing: REFLOW_EASING },
      );
    };

    const finishDrag = (cancelled: boolean) => {
      stop();
      if (!session.active) return;
      if (!cancelled) reflow();
      const dropped = !cancelled && !session.outside && session.at !== null;
      settle();
      setGesture(null);
      if (!dropped) {
        if (placed) setTiles(origin);
        setAnnounce(`${tileDefinition(key).title} : déplacement annulé.`);
      } else if (placed) {
        setAnnounce(
          `${tileDefinition(key).title} : position ${(session.at ?? 0) + 1} sur ${tiles.length}.`,
        );
      } else {
        addTile(key, session.at ?? undefined);
      }
    };

    const onUp = (next: PointerEvent) => {
      if (next.pointerId === pointerId) finishDrag(false);
    };
    const onCancel = (next: PointerEvent) => {
      if (next.pointerId === pointerId) finishDrag(true);
    };
    const onKey = (next: KeyboardEvent) => {
      if (next.key !== "Escape") return;
      next.preventDefault();
      next.stopPropagation();
      finishDrag(true);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    stopDrag.current = stop;
  }

  /** La poignée a son propre suivi du pointeur : ici, seulement les emplacements et l'ordre figé. */
  function beginResize(key: TileKey) {
    const board = grid.current;
    if (!board) return;
    settlePageBuild();
    noFlip.current = key;
    setGesture({
      kind: "resize",
      key,
      columns: measureGrid(board).columns,
      domKeys: tiles.map((item) => item.key),
      at: null,
      outside: false,
      ghost: null,
    });
  }

  function finish() {
    startSaving(async () => {
      const result = await saveLayout(tiles);
      if (result.status === "error") {
        toast({ tone: "danger", message: result.message });
        return;
      }
      router.push("/");
    });
  }

  const adding = gesture?.kind === "add" ? tileDefinition(gesture.key) : null;
  const shown =
    adding && gesture?.at != null
      ? insertTile(tiles, { key: adding.key, size: adding.size }, gesture.at)
      : tiles;
  const placements = gesture ? packTiles(shown, gesture.columns) : null;
  const slots = placements && gesture ? emptyCells(placements, gesture.columns) : [];
  const landing = gesture && gesture.kind !== "resize" ? placements?.get(gesture.key) : undefined;
  const byKey = new Map(tiles.map((tile) => [tile.key, tile]));
  const rendered = gesture ? gesture.domKeys.flatMap((key) => byKey.get(key) ?? []) : tiles;

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      {editing ? (
        <aside
          ref={panel}
          aria-label="Galerie de tuiles"
          className={cn(
            "fixed right-3 z-30 flex rounded-xl bg-surface shadow-float transition-opacity duration-(--dur-fast) max-lg:left-3 lg:top-3",
            galleryOpen
              ? "bottom-3 flex-col gap-4 p-6 lg:w-[360px]"
              : "flex-wrap items-center justify-between gap-3 p-3 max-lg:bottom-3",
            // Pendant un geste, le panneau s'efface : les emplacements dessous restent atteignables.
            gesture && "pointer-events-none opacity-0",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            {galleryOpen ? (
              <h2 className="text-client-card-title text-ink">Ajouter une tuile</h2>
            ) : null}
            {/* Le même bouton réduit et rouvre : le focus du clavier y reste. */}
            <button
              type="button"
              aria-expanded={galleryOpen}
              aria-controls={galleryOpen ? galleryId : undefined}
              aria-label={galleryOpen ? "Réduire la galerie" : "Rouvrir la galerie"}
              onClick={() => setGalleryOpen((open) => !open)}
              className="hit-44 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-compact-button whitespace-nowrap text-accent transition-colors duration-(--dur-fast) hover:bg-accent-pale/40"
            >
              <Icon name="chevron" size={16} className={galleryOpen ? undefined : "rotate-180"} />
              {galleryOpen ? null : "Galerie"}
            </button>
          </div>
          {galleryOpen ? (
            <div id={galleryId} className="flex min-h-0 flex-1 flex-col gap-4">
              <p className="text-sm text-muted">
                Glissez une tuile sur le tableau, ou cliquez pour l’ajouter à la fin. Hors du
                tableau, le dépôt est annulé.
              </p>
              <div className="flex max-h-[40dvh] min-h-0 flex-1 flex-col gap-2 overflow-y-auto lg:max-h-none">
                {available.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted">
                    Toutes vos tuiles sont sur le tableau.
                  </p>
                ) : (
                  available.map((definition) => (
                    <GalleryItem
                      key={definition.key}
                      definition={definition}
                      onAdd={addTile}
                      onDragStart={beginDrag}
                    />
                  ))
                )}
              </div>
            </div>
          ) : null}
          <div className={cn("flex items-center justify-end gap-3", galleryOpen && "pt-2")}>
            <ButtonLink href="/">Annuler</ButtonLink>
            <Button variant="accent" loading={saving} onClick={finish}>
              Terminé
            </Button>
          </div>
        </aside>
      ) : null}

      {/* Le panneau flotte au-dessus du tableau : ouvert ou réduit, aucune tuile ne bouge. */}
      <div className={cn("@container", editing && "max-lg:pb-24")}>
        <div ref={grid} className={cn(TILE_GRID, "relative grid-flow-row-dense auto-rows-[168px]")}>
          {slots.map((cell) => (
            <TileSlot key={`${cell.column}:${cell.row}`} style={placementStyle(cell)} />
          ))}
          {landing ? (
            <TileSlot
              data-slot-landing
              active={!gesture?.outside}
              style={placementStyle(landing)}
            />
          ) : null}
          {rendered.map((item) => (
            <BoardTile
              key={item.key}
              item={item}
              position={tiles.indexOf(item)}
              count={tiles.length}
              state={data.tiles[item.key]}
              editing={editing}
              placement={placements?.get(item.key)}
              active={gesture?.key === item.key && gesture.kind !== "add" ? gesture.kind : null}
              onResizeBegin={beginResize}
              onResizePreview={previewSize}
              onResizeCommit={commitSize}
              onResizeEnd={() => setGesture(null)}
              onRemove={removeTile}
              onMove={moveByKeyboard}
              onDragStart={beginDrag}
            />
          ))}
          {!editing ? (
            tiles.length === 0 ? (
              <div className="col-span-2 row-span-1">
                <Tile className="h-full">
                  <EmptyState
                    compact
                    icon="dashboard"
                    title="Votre tableau est vide"
                    description="Ajoutez les tuiles qui vous servent."
                    className="my-auto py-0"
                  />
                </Tile>
              </div>
            ) : null
          ) : null}
          {!editing ? (
            <div className="contents" style={staggerIndex(tiles.length)}>
              <AddTile href="/?edition=1" label="Ajouter une tuile" />
            </div>
          ) : null}
        </div>
      </div>

      {adding && gesture?.ghost ? (
        <div
          ref={ghost}
          aria-hidden="true"
          style={{
            width: gesture.ghost.width,
            height: gesture.ghost.height,
            transform: `translate(${gesture.ghost.x}px, ${gesture.ghost.y}px)`,
          }}
          className="pointer-events-none fixed top-0 left-0 z-40 opacity-95 [&>article]:shadow-float"
        >
          <Tile icon={adding.icon} title={adding.title} editing fit className="h-full">
            <div className="tile-body">
              <TileBody
                state={data.tiles[adding.key]}
                size={adding.size}
                editing
                service={adding.title}
              />
            </div>
          </Tile>
        </div>
      ) : null}
    </>
  );
}

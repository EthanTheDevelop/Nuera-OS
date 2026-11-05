"use client";

import { motion, useDragControls, type PanInfo } from "motion/react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { staggerIndex } from "@/components/motion/stagger";
import { EmptyState } from "@/components/states/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { AddTile, Tile, TileRemoveButton, TileResizeHandle } from "@/components/ui/tile";
import { useToast } from "@/components/ui/toast";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { saveDashboardLayoutAction } from "../dashboard.actions";
import {
  moveTile,
  nearestTileSize,
  stepTileSize,
  TILE_CATALOG,
  tileDefinition,
  tileSpan,
  type DashboardTileSize,
  type LayoutTile,
  type TileDefinition,
  type TileKey,
} from "../dashboard.tiles";
import type { DashboardData, TileState } from "../dashboard.types";
import { tileBadge, TileBody } from "./tile-body";

/** Mêmes colonnes que les formats de `Tile` : ici, c'est l'enveloppe animée qui occupe la grille. */
const TILE_SPAN: Record<DashboardTileSize, string> = {
  "1x1": "",
  "2x1": "col-span-2",
  "2x2": "col-span-2 row-span-2",
  "4x2": "col-span-2 @lg:col-span-4 row-span-2",
};

const SWAP_COOLDOWN_MS = 250;

const sizeLabel = (size: DashboardTileSize) => size.replace("x", "×");

/** Flèches sur la poignée : vers le bas et la droite, on agrandit, comme en la tirant. */
const ARROW_STEP: Partial<Record<string, -1 | 1>> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
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

/** La tuile sous le pointeur, en ignorant celle qu'on déplace. */
function tileUnderPointer(info: Pick<PanInfo, "point">, except?: TileKey): TileKey | null {
  const elements = document.elementsFromPoint(
    info.point.x - window.scrollX,
    info.point.y - window.scrollY,
  );
  for (const element of elements) {
    const host = element.closest<HTMLElement>("[data-tile-key]");
    const key = host?.dataset.tileKey as TileKey | undefined;
    if (key && key !== except) return key;
  }
  return null;
}

/**
 * Poignée de taille : suit le pointeur, souris ou doigt, et propose le format le plus proche à chaque
 * mouvement. Le calcul part de la mesure au départ du geste : une tuile que la grille replace pendant
 * l'aperçu ne fait pas sauter le format. Sans déplacement, un clic ne change rien. Échap annule.
 */
function BoardResizeHandle({
  item,
  label,
  onPreview,
  onCommit,
}: {
  item: LayoutTile;
  label: string;
  onPreview: (key: TileKey, size: DashboardTileSize) => void;
  onCommit: (key: TileKey, size: DashboardTileSize) => void;
}) {
  const gesture = useRef<{
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
    const size = nearestTileSize(
      item.key,
      drag.last,
      {
        columns: (drag.width + event.pageX - drag.x + drag.gap) / drag.columnTrack,
        rows: (drag.height + event.pageY - drag.y + drag.gap) / drag.rowTrack,
      },
      drag.gridColumns,
    );
    if (size === drag.last) return;
    drag.last = size;
    onPreview(item.key, size);
  }

  function end() {
    const drag = gesture.current;
    gesture.current = null;
    if (drag && drag.last !== drag.start) onCommit(item.key, drag.last);
  }

  function cancel() {
    const drag = gesture.current;
    gesture.current = null;
    if (drag && drag.last !== drag.start) onPreview(item.key, drag.start);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      cancel();
      return;
    }
    const step = ARROW_STEP[event.key];
    if (!step) return;
    event.preventDefault();
    const size = stepTileSize(item.key, item.size, step);
    if (size !== item.size) onCommit(item.key, size);
  }

  return (
    <TileResizeHandle
      tileName={`${label}, format ${sizeLabel(item.size)}. Glissez, ou utilisez les flèches`}
      editing
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={cancel}
      onKeyDown={onKeyDown}
    />
  );
}

function BoardTile({
  item,
  position,
  count,
  state,
  editing,
  dropTarget,
  onResizePreview,
  onResizeCommit,
  onRemove,
  onMove,
  onDragOver,
  onDragDone,
}: {
  item: LayoutTile;
  position: number;
  count: number;
  state: TileState | undefined;
  editing: boolean;
  dropTarget: boolean;
  onResizePreview: (key: TileKey, size: DashboardTileSize) => void;
  onResizeCommit: (key: TileKey, size: DashboardTileSize) => void;
  onRemove: (key: TileKey) => void;
  onMove: (key: TileKey, to: number) => void;
  onDragOver: (key: TileKey, info: PanInfo) => void;
  onDragDone: () => void;
}) {
  const preset = useMotionPreset();
  const controls = useDragControls();
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
    // Au doigt, seule la poignée dédiée déplace : le reste de la tuile laisse défiler la page.
    if (event.pointerType === "touch") return;
    if ((event.target as HTMLElement).closest("button,a")) return;
    controls.start(event);
  }

  return (
    <motion.div
      layout={preset.reduced ? false : "position"}
      transition={{ layout: preset.move }}
      drag={editing}
      dragControls={controls}
      dragListener={false}
      dragSnapToOrigin
      dragElastic={1}
      dragMomentum={false}
      whileDrag={{ zIndex: 20, cursor: "grabbing" }}
      onDrag={(_, info) => onDragOver(item.key, info)}
      onDragEnd={onDragDone}
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
      style={staggerIndex(position)}
      className={cn(
        "relative min-w-0 rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        TILE_SPAN[item.size],
        editing && "cursor-grab select-none",
        dropTarget && "ring-2 ring-accent ring-offset-2",
      )}
    >
      <Tile
        icon={definition.icon}
        title={title}
        aside={item.size === "1x1" ? undefined : tileBadge(state)}
        href={editing ? undefined : (definition.href ?? undefined)}
        editing={editing}
        className="h-full"
        handle={
          editing ? (
            <BoardResizeHandle
              item={item}
              label={title}
              onPreview={onResizePreview}
              onCommit={onResizeCommit}
            />
          ) : null
        }
        removeControl={
          editing ? (
            <>
              <TileRemoveButton tileName={title} onClick={() => onRemove(item.key)} />
              <div
                role="presentation"
                onPointerDown={(event) => controls.start(event)}
                className="absolute top-1 right-1 z-10 hidden size-8 touch-none items-center justify-center rounded-full text-muted pointer-coarse:flex"
              >
                <Icon name="menu" size={16} />
              </div>
            </>
          ) : null
        }
      >
        {/* Le cadre et le titre d'abord, le contenu ensuite (note M1). */}
        <div className="anim-data flex min-h-0 min-w-0 flex-1 flex-col">
          <TileBody state={state} size={item.size} editing={editing} service={definition.title} />
        </div>
      </Tile>
    </motion.div>
  );
}

function GalleryItem({
  definition,
  onAdd,
  onDragState,
  onDropAt,
}: {
  definition: TileDefinition;
  onAdd: (key: TileKey) => void;
  onDragState: (dragging: boolean) => void;
  onDropAt: (key: TileKey, info: PanInfo) => void;
}) {
  const dragged = useRef(false);
  const controls = useDragControls();
  return (
    <motion.button
      type="button"
      data-gallery-item
      drag
      dragControls={controls}
      dragListener={false}
      onPointerDown={(event) => {
        // Au doigt, la liste défile : on y ajoute au toucher.
        if (event.pointerType !== "touch") controls.start(event);
      }}
      dragSnapToOrigin
      dragElastic={1}
      dragMomentum={false}
      whileDrag={{ zIndex: 40, boxShadow: "var(--shadow-float)" }}
      onDragStart={() => {
        dragged.current = true;
        onDragState(true);
      }}
      onDragEnd={(_, info) => {
        // Motion prévient après le clic du relâchement : le drapeau tombe seulement ici.
        dragged.current = false;
        onDragState(false);
        onDropAt(definition.key, info);
      }}
      onClick={() => {
        // Le clic du relâchement n'est pas un ajout : c'est le dépôt qui décide.
        if (!dragged.current) onAdd(definition.key);
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
    </motion.button>
  );
}

/**
 * Tableau de bord (écrans 01 et 06). La poignée n'existe qu'en édition, où rien n'est enregistré
 * avant « Terminé » : le serveur valide, « Annuler » abandonne. Le panneau de la galerie se réduit
 * le temps de l'édition, et le tableau reprend alors la largeur libérée.
 */
export function DashboardBoard({ data, editing }: { data: DashboardData; editing: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const galleryId = useId();
  const [galleryOpen, setGalleryOpen] = useState(true);
  const [tiles, setTiles] = useState<LayoutTile[]>(data.layout.tiles);
  const [announce, setAnnounce] = useState("");
  const [dropTarget, setDropTarget] = useState<TileKey | null>(null);
  const [galleryDragging, setGalleryDragging] = useState(false);
  const [saving, startSaving] = useTransition();
  const lastSwap = useRef(0);
  const panel = useRef<HTMLElement>(null);

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

  function onDragOver(key: TileKey, info: PanInfo) {
    const now = performance.now();
    if (now - lastSwap.current < SWAP_COOLDOWN_MS) return;
    const hovered = tileUnderPointer(info, key);
    if (!hovered) return;
    const target = tiles.findIndex((tile) => tile.key === hovered);
    if (target < 0) return;
    lastSwap.current = now;
    setTiles((current) => moveTile(current, key, target));
  }

  function onGalleryDrop(key: TileKey, info: PanInfo) {
    const x = info.point.x - window.scrollX;
    const y = info.point.y - window.scrollY;
    const box = panel.current?.getBoundingClientRect();
    const overPanel = box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    setDropTarget(null);
    if (overPanel) return;
    const hovered = tileUnderPointer(info);
    const at = hovered ? tiles.findIndex((tile) => tile.key === hovered) : -1;
    addTile(key, at >= 0 ? at : undefined);
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
            "z-30 mb-6 flex rounded-xl bg-surface shadow-float lg:fixed lg:top-3 lg:right-3 lg:mb-0",
            galleryOpen
              ? "flex-col gap-4 p-6 lg:bottom-3 lg:w-[360px]"
              : "flex-wrap items-center justify-between gap-3 p-3",
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
                Glissez une tuile sur le tableau, ou cliquez pour l’ajouter à la fin.
              </p>
              <div
                className={cn(
                  "flex max-h-[40dvh] min-h-0 flex-1 flex-col gap-2 lg:max-h-none",
                  galleryDragging ? "overflow-visible" : "overflow-y-auto",
                )}
              >
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
                      onDragState={setGalleryDragging}
                      onDropAt={onGalleryDrop}
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

      <div
        className={cn(
          "@container",
          // Le panneau flotte à droite : le tableau lui laisse sa place, et la reprend quand il se réduit.
          editing && galleryOpen && "lg:pr-[364px]",
        )}
      >
        <div className="grid grid-flow-row-dense auto-rows-[minmax(168px,auto)] grid-cols-2 gap-(--grid-gap) @lg:grid-cols-4 @5xl:grid-cols-6">
          {tiles.map((item, index) => (
            <BoardTile
              key={item.key}
              item={item}
              position={index}
              count={tiles.length}
              state={data.tiles[item.key]}
              editing={editing}
              dropTarget={dropTarget === item.key}
              onResizePreview={previewSize}
              onResizeCommit={commitSize}
              onRemove={removeTile}
              onMove={moveByKeyboard}
              onDragOver={onDragOver}
              onDragDone={() => setDropTarget(null)}
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
    </>
  );
}

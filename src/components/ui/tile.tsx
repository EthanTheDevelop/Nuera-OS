import Link from "next/link";
import { Children, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { staggerIndex } from "@/components/motion/stagger";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icon";

/**
 * En-tête de tuile (Figma 57:130) : pastille 28 + titre, à droite un badge ou une action.
 * Sert aussi d'en-tête de carte. `titleAs` règle le niveau de titre (`h2` par défaut).
 */
export function TileHeader({
  icon,
  title,
  aside,
  href,
  titleAs: Title = "h2",
  className,
}: {
  icon: IconName;
  title: ReactNode;
  aside?: ReactNode;
  /** Rend toute la tuile cliquable : le lien du titre s'étend sur le bloc parent. */
  href?: string;
  titleAs?: "h2" | "h3" | "h4";
  className?: string;
}) {
  return (
    <header className={cn("flex min-h-7 items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-accent-pale text-accent"
      >
        <Icon name={icon} size={16} />
      </span>
      <Title className="min-w-0 flex-1 text-tile-title text-ink">
        {href ? (
          <Link
            href={href}
            className="rounded-sm after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
          >
            {title}
          </Link>
        ) : (
          title
        )}
      </Title>
      {aside ? <div className="relative z-10 shrink-0">{aside}</div> : null}
    </header>
  );
}

/** Formats de tuile de l'écran 01 : colonnes × lignes de la grille. */
export type TileSize = "1x1" | "2x1" | "2x2" | "4x2";

const TILE_SIZES: Record<TileSize, string> = {
  "1x1": "",
  "2x1": "col-span-2",
  "2x2": "col-span-2 row-span-2",
  "4x2": "col-span-2 @lg:col-span-4 row-span-2",
};

/**
 * Tuile (Figma 58:397) : rayon 28, `Shadow/Soft`, `padding 20`, gap 12, sans bordure.
 * Compatible serveur. En mode édition (écran 06) : bordure 2 px accent, rond « Retirer » via
 * `removeControl` ; la poignée de taille vient de `handle` (voir `TileResizeHandle`).
 */
export function Tile({
  icon,
  title,
  aside,
  href,
  size,
  editing = false,
  handle,
  removeControl,
  className,
  children,
}: {
  icon?: IconName;
  title?: ReactNode;
  aside?: ReactNode;
  href?: string;
  /** Format dans une `TileGrid`. Sans format, la tuile prend la place que son parent lui donne. */
  size?: TileSize;
  editing?: boolean;
  handle?: ReactNode;
  removeControl?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <article
      className={cn(
        "anim-content relative flex min-w-0 flex-col gap-(--tile-gap) rounded-xl bg-surface p-(--tile-pad) shadow-soft",
        editing && "outline-2 -outline-offset-2 outline-accent",
        size && TILE_SIZES[size],
        className,
      )}
    >
      {icon && title ? <TileHeader icon={icon} title={title} aside={aside} href={href} /> : null}
      {children}
      {handle}
      {removeControl}
    </article>
  );
}

/**
 * Grille de l'écran 01 : colonnes de 168 environ, gouttière 24, lignes de 168. Selon sa largeur,
 * 2 → 4 → 6 colonnes, puis 8, 10 et 12 sur grand écran : la grille gagne des colonnes plutôt que
 * d'étirer les tuiles, toujours par nombre pair pour que les formats à 2 colonnes s'alignent.
 */
export const TILE_GRID =
  "grid auto-rows-[minmax(168px,auto)] grid-cols-2 gap-(--grid-gap) @lg:grid-cols-4 @5xl:grid-cols-6 @[96rem]:grid-cols-8 @[120rem]:grid-cols-10 @[144rem]:grid-cols-12";

/** Grille de tuiles : les tuiles entrent en cascade, 60 ms d'écart. */
export function TileGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="@container">
      <div className={cn(TILE_GRID, className)}>
        {Children.toArray(children).map((child, index) => (
          <div key={index} className="contents" style={staggerIndex(index)}>
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Tuile « Ajouter » (Figma 58:621) : pointillés, plus 18 dans un rond accent pâle. */
export function AddTile({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "anim-content flex min-h-[168px] flex-col items-center justify-center gap-3 rounded-xl border-[1.5px] border-dashed border-border p-5 text-center text-nav-search font-medium text-accent",
        "transition-colors duration-(--dur-fast) hover:border-accent hover:bg-accent-pale/40",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-full bg-accent-pale shadow-soft"
      >
        <Icon name="plus" size={18} />
      </span>
      {label}
    </Link>
  );
}

/**
 * Emplacement de la grille pendant un geste d'édition : contour discret quand il est libre, accent
 * là où la tuile va se poser. Décoratif : le geste s'annonce par ailleurs aux lecteurs d'écran.
 */
export function TileSlot({
  active = false,
  ...props
}: { active?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none rounded-xl",
        active
          ? "border-2 border-accent bg-accent-pale/40"
          : "border-[1.5px] border-dashed border-border",
      )}
      {...props}
    />
  );
}

/** Chiffre de tuile : 26/600, ou 40/600 en `hero` (tuile 4×2), avec sa note. */
export function TileFigure({
  value,
  note,
  noteTone = "muted",
  hero = false,
  unit,
  className,
}: {
  value: ReactNode;
  note?: ReactNode;
  noteTone?: "muted" | "warn" | "danger" | "success";
  hero?: boolean;
  /** Complément à droite du chiffre (`journées vendues`). */
  unit?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("@container mt-auto flex w-full min-w-0 flex-col gap-1", className)}>
      <p
        className={cn(
          "flex flex-wrap items-baseline gap-2 text-ink",
          hero ? "text-figure-hero" : "text-figure",
        )}
      >
        <span className="tabular">{value}</span>
        {unit ? <span className="text-sm font-normal text-muted">{unit}</span> : null}
      </p>
      {note ? (
        <p
          className={cn(
            "text-kpi-note",
            noteTone === "muted" && "text-muted",
            noteTone === "warn" && "text-warn",
            noteTone === "danger" && "text-danger",
            noteTone === "success" && "text-success",
          )}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** Arc de même centre que l'angle de la tuile (`--radius-xl`, 28) : il épouse son bord. */
const HANDLE_PATH = "M25.6 6.86A26.5 26.5 0 0 1 6.86 25.6";

function HandleGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d={HANDLE_PATH} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Poignée de taille, 28 × 28, posée sur l'angle bas droit de la tuile.
 * Le tableau de bord la pose en édition seulement et la branche sur le glisser et les flèches :
 * un simple clic ne change rien. `touch-none` : au doigt, le geste tire la poignée sans défiler.
 */
export function TileResizeHandle({
  tileName,
  editing = false,
  className,
  ...props
}: { tileName: string; editing?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={`Redimensionner la tuile ${tileName}`}
      className={cn(
        "hit-44 absolute right-0 bottom-0 z-10 flex size-7 cursor-nwse-resize touch-none items-center justify-center rounded-sm",
        editing ? "text-accent" : "text-muted",
        className,
      )}
      {...props}
    >
      <HandleGlyph />
    </button>
  );
}

/** Bouton « Retirer la tuile » (Figma 150:6910) : rond 24, zone cliquable 32, moins rouge. */
export function TileRemoveButton({
  tileName,
  className,
  ...props
}: { tileName: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={`Retirer la tuile ${tileName}`}
      className={cn(
        "absolute -top-1 -left-1 z-10 flex size-8 items-center justify-center rounded-full",
        className,
      )}
      {...props}
    >
      <span className="flex size-6 items-center justify-center rounded-full border border-border bg-surface text-danger shadow-soft">
        <Icon name="minus" size={14} />
      </span>
    </button>
  );
}

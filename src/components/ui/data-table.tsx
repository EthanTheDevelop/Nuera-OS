import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { hrefWith, paramValue, type SearchParamsLike } from "@/lib/url-state";
import { Avatar, type AvatarSize } from "./avatar";
import { Icon } from "./icon";

export interface DataTableColumn<Row> {
  key: string;
  /** Titre, écrit en capitales comme dans Figma (`CLIENT`, `STATUT`). */
  header: string;
  /** Largeur en px (colonnes Figma). Sans largeur : la colonne prend le reste (`flex`). */
  width?: number;
  align?: "left" | "right";
  cell: (row: Row) => ReactNode;
  /** Colonne triable côté serveur : l'en-tête devient un lien qui pose `?tri=…&sens=…`. */
  sortable?: boolean;
  /** Colonne qui porte le lien de la ligne ; en tête de fiche une fois replié. Défaut : la 1re. */
  primary?: boolean;
  /** Masquée quand le tableau se replie en fiches. */
  hideWhenCollapsed?: boolean;
}

export interface DataTableQuery {
  /** Chemin de la page (`/clients`). */
  pathname: string;
  /** Les `searchParams` reçus par la page. */
  searchParams?: SearchParamsLike;
}

export interface DataTablePage {
  page: number;
  pageSize: number;
  total: number;
}

const ROW_HEIGHT = { sm: "--row-h-sm", md: "--row-h-md", lg: "--row-h-lg" } as const;

export const SORT_PARAM = "tri";
export const SORT_DIRECTION_PARAM = "sens";
export const PAGE_PARAM = "page";

/**
 * Tableau générique (Figma 87:2049), compatible serveur : tri et pagination sont de vrais liens
 * dans l'URL, donc les requêtes restent côté serveur, pour des centaines de lignes.
 *
 * - La ligne cliquable est un vrai lien : `rowHref` pose un `<Link>` sur la cellule principale,
 *   étendu à toute la ligne. Tabulation, clic du milieu et lecteur d'écran fonctionnent.
 *   Une cellule interactive doit porter la classe `relative z-10`.
 * - Sous 640 px de large, les lignes se replient en fiches (`hideWhenCollapsed` pour alléger).
 * - `rowHeight` : `sm` 45 (par défaut), `md` 49, `lg` 66 (Figma selon l'écran).
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  rowHref,
  rowHeight = "sm",
  caption,
  query,
  pagination,
  empty,
  className,
}: {
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string | undefined;
  rowHeight?: keyof typeof ROW_HEIGHT;
  /** Titre du tableau, annoncé aux lecteurs d'écran. */
  caption: string;
  /** Requise dès qu'une colonne est triable ou qu'il y a une pagination. */
  query?: DataTableQuery;
  pagination?: DataTablePage;
  /** Affiché à la place des lignes quand il n'y en a aucune (voir `EmptyState`). */
  empty?: ReactNode;
  className?: string;
}) {
  const primaryKey = columns.find((column) => column.primary)?.key ?? columns[0]?.key;
  const sortKey = paramValue(query?.searchParams, SORT_PARAM);
  const sortDirection =
    paramValue(query?.searchParams, SORT_DIRECTION_PARAM) === "desc" ? "desc" : "asc";

  return (
    <div className={cn("anim-content h-fit rounded-lg bg-surface shadow-soft", className)}>
      <div className="overflow-hidden rounded-lg [container:data-table/inline-size]">
        <table role="table" className="nu-table w-full table-fixed border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={column.width ? { width: column.width } : undefined} />
            ))}
          </colgroup>
          <thead role="rowgroup">
            <tr role="row" className="h-[45px] border-b border-border">
              {columns.map((column) => {
                const sorted = sortKey === column.key;
                return (
                  <th
                    key={column.key}
                    role="columnheader"
                    scope="col"
                    aria-sort={
                      column.sortable
                        ? sorted
                          ? sortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                        : undefined
                    }
                    className={cn(
                      "px-2 font-mono text-table-head text-muted uppercase first:pl-5 last:pr-5",
                      column.align === "right" && "text-right",
                    )}
                  >
                    {column.sortable && query ? (
                      <Link
                        href={hrefWith(query.pathname, query.searchParams, {
                          [SORT_PARAM]: column.key,
                          [SORT_DIRECTION_PARAM]:
                            sorted && sortDirection === "asc" ? "desc" : "asc",
                          [PAGE_PARAM]: null,
                        })}
                        className="hit-44 inline-flex items-center gap-1 hover:text-text"
                      >
                        {column.header}
                        <Icon
                          name="chevron"
                          size={12}
                          className={cn(
                            "transition-transform duration-(--dur-fast)",
                            sorted && sortDirection === "desc" ? "rotate-90" : "-rotate-90",
                            !sorted && "opacity-40",
                          )}
                        />
                      </Link>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  role="row"
                  style={{ height: `var(${ROW_HEIGHT[rowHeight]})` } as CSSProperties}
                  className={cn(
                    "relative border-b border-border last:border-b-0",
                    href &&
                      "transition-colors duration-(--dur-fast) hover:bg-surface-raised/60 has-[a[data-row-link]:focus-visible]:outline-2 has-[a[data-row-link]:focus-visible]:-outline-offset-2 has-[a[data-row-link]:focus-visible]:outline-focus",
                  )}
                >
                  {columns.map((column) => {
                    const isPrimary = column.key === primaryKey;
                    return (
                      <td
                        key={column.key}
                        role="cell"
                        data-label={column.header}
                        data-primary={isPrimary ? "" : undefined}
                        data-hide-collapsed={column.hideWhenCollapsed ? "" : undefined}
                        className={cn(
                          "min-w-0 px-2 text-cell text-muted first:pl-5 last:pr-5",
                          column.align === "right" && "text-right",
                        )}
                      >
                        {isPrimary && href ? (
                          <Link
                            href={href}
                            data-row-link
                            className="block min-w-0 after:absolute after:inset-0 focus-visible:outline-none"
                          >
                            {column.cell(row)}
                          </Link>
                        ) : (
                          column.cell(row)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <div className="p-5">{empty}</div> : null}
      </div>
      {pagination && query ? <DataTablePagination query={query} {...pagination} /> : null}
    </div>
  );
}

/** Cellule d'identité (colonne CLIENT, PROJET, DEVIS) : avatar, principal 14/600, secondaire 12. */
export function CellIdentity({
  name,
  initials,
  title,
  subtitle,
  avatarSize = 32,
}: {
  /** Sert aux initiales. Absent : pas d'avatar. */
  name?: string;
  initials?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  avatarSize?: AvatarSize;
}) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {name || initials ? <Avatar name={name} initials={initials} size={avatarSize} /> : null}
      <span className="min-w-0">
        <span className="block truncate text-row-primary text-ink">{title}</span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-row-secondary text-muted">{subtitle}</span>
        ) : null}
      </span>
    </span>
  );
}

/** Valeur de cellule en mono (montants, dates compactes). */
export function CellMono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-amount-compact text-muted">{children}</span>;
}

function pageList(page: number, last: number): (number | "gap")[] {
  const pages = new Set([1, last, page, page - 1, page + 1]);
  const sorted = [...pages].filter((value) => value >= 1 && value <= last).sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  for (const value of sorted) {
    const previous = result[result.length - 1];
    if (typeof previous === "number" && value - previous > 1) result.push("gap");
    result.push(value);
  }
  return result;
}

function PageControl({
  href,
  label,
  current = false,
  children,
}: {
  href?: string;
  label: string;
  current?: boolean;
  children: ReactNode;
}) {
  const classes = cn(
    "flex size-9 items-center justify-center rounded-md font-mono text-counter",
    current ? "bg-accent-pale text-accent" : "text-muted",
    href &&
      !current &&
      "transition-colors duration-(--dur-fast) hover:bg-surface-raised hover:text-text",
    !href && !current && "opacity-40",
  );
  if (!href) {
    return (
      <span className={classes} aria-disabled="true" aria-current={current ? "page" : undefined}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      className={classes}
    >
      {children}
    </Link>
  );
}

/** Pagination serveur : `{ items, total, page, pageSize }` du contrat de domaine (§2). */
export function DataTablePagination({
  query,
  page,
  pageSize,
  total,
  className,
}: DataTablePage & { query: DataTableQuery; className?: string }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), last);
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);
  const hrefFor = (target: number) =>
    hrefWith(query.pathname, query.searchParams, { [PAGE_PARAM]: target === 1 ? null : target });

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-2",
        className,
      )}
    >
      <p className="tabular text-row-secondary text-muted" aria-live="polite">
        {start}–{end} sur {total}
      </p>
      {last > 1 ? (
        <ol className="flex items-center gap-1">
          <li>
            <PageControl
              href={current > 1 ? hrefFor(current - 1) : undefined}
              label="Page précédente"
            >
              <Icon name="chevron" size={14} className="rotate-180" />
            </PageControl>
          </li>
          {pageList(current, last).map((value, index) =>
            value === "gap" ? (
              <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-muted">
                …
              </li>
            ) : (
              <li key={value}>
                <PageControl
                  href={hrefFor(value)}
                  label={`Page ${value}`}
                  current={value === current}
                >
                  {value}
                </PageControl>
              </li>
            ),
          )}
          <li>
            <PageControl
              href={current < last ? hrefFor(current + 1) : undefined}
              label="Page suivante"
            >
              <Icon name="chevron" size={14} />
            </PageControl>
          </li>
        </ol>
      ) : null}
    </nav>
  );
}

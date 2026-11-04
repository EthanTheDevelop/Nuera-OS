/**
 * Pagination côté serveur, forme unique des listes (`docs/domain-model.md` §2) :
 * `{ items, total, page, pageSize }`. Fichier pur, importable côté interface pour ses types.
 */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageParams {
  page: number;
  pageSize: number;
}

export interface Paginated<T> extends PageParams {
  items: T[];
  total: number;
}

function toPositiveInt(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "number" ? raw : Number(typeof raw === "string" ? raw : Number.NaN);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

/**
 * Lit `page` et `pageSize` depuis une entrée non fiable (`searchParams`, `URLSearchParams`).
 * Une valeur invalide vaut la valeur par défaut : une URL trafiquée n'est pas une erreur.
 * La taille est plafonnée à `maxPageSize`.
 */
export function parsePagination(
  input: URLSearchParams | { page?: unknown; pageSize?: unknown } | null | undefined,
  options: { defaultPageSize?: number; maxPageSize?: number } = {},
): PageParams {
  const { defaultPageSize = DEFAULT_PAGE_SIZE, maxPageSize = MAX_PAGE_SIZE } = options;
  const source =
    input instanceof URLSearchParams
      ? { page: input.get("page"), pageSize: input.get("pageSize") }
      : (input ?? {});
  return {
    page: toPositiveInt(source.page) ?? 1,
    pageSize: Math.min(toPositiveInt(source.pageSize) ?? defaultPageSize, maxPageSize),
  };
}

/** Décalage SQL de la page. */
export function pageOffset({ page, pageSize }: PageParams): number {
  return (page - 1) * pageSize;
}

export function paginated<T>(items: T[], total: number, params: PageParams): Paginated<T> {
  return { items, total, page: params.page, pageSize: params.pageSize };
}

/** Nombre de pages, au moins 1 : une liste vide affiche sa page 1. */
export function totalPages({ total, pageSize }: Pick<Paginated<unknown>, "total" | "pageSize">) {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Exécute la requête de page et le comptage, tous deux écrits par le dépôt :
 *
 *   paginate(params, {
 *     items: (limit, offset) => db.select().from(sites).limit(limit).offset(offset),
 *     count: () => db.$count(sites),
 *   })
 */
export async function paginate<T>(
  params: PageParams,
  query: {
    items: (limit: number, offset: number) => Promise<T[]>;
    count: () => Promise<number>;
  },
): Promise<Paginated<T>> {
  const [items, total] = await Promise.all([
    query.items(params.pageSize, pageOffset(params)),
    query.count(),
  ]);
  return paginated(items, total, params);
}

/**
 * Transforme une saisie en requête `tsquery` par préfixes, sans caractère interprété par
 * PostgreSQL : « dupo mar » donne `dupo:* & mar:*`. `null` si rien d'utile n'a été saisi.
 * À utiliser avec les index GIN `*_search_idx` du schéma, avec la même expression :
 *
 *   sql`to_tsvector('simple', ${companies.name}) @@ to_tsquery('simple', ${prefixTsQuery(q)})`
 *
 * La configuration `simple` ne retire pas les accents : « societe » ne trouve pas « Société ».
 */
export function prefixTsQuery(search: string | null | undefined): string | null {
  const terms = (search ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return terms.length > 0 ? terms.map((term) => `${term}:*`).join(" & ") : null;
}

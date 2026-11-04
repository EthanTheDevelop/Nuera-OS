/**
 * État d'écran porté par l'URL (filtres, tri, pagination) : partageable, compatible serveur.
 * Le type des `searchParams` de Next.js est accepté tel quel.
 */
export type SearchParamsLike =
  URLSearchParams | Record<string, string | string[] | undefined> | undefined;

function toParams(input: SearchParamsLike): URLSearchParams {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input ?? {})) {
    if (Array.isArray(value)) for (const item of value) params.append(key, item);
    else if (value !== undefined) params.set(key, value);
  }
  return params;
}

/**
 * Lien vers la même page avec des paramètres modifiés. `null` ou `undefined` retire le paramètre.
 * Changer un filtre doit revenir à la première page : passer `page: null`.
 */
export function hrefWith(
  pathname: string,
  searchParams: SearchParamsLike,
  patch: Record<string, string | number | null | undefined>,
): string {
  const params = toParams(searchParams);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function paramValue(input: SearchParamsLike, key: string): string | undefined {
  return toParams(input).get(key) ?? undefined;
}

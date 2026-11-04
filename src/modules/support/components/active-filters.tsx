import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { hrefWith, type SearchParamsLike } from "@/lib/url-state";

export interface ActiveFilter {
  param: string;
  label: string;
}

/**
 * Filtres arrivés par un lien (récurrence, « de plus dans la liste », fiche d'un site) : sans ces
 * pastilles, ils restaient invisibles et aucun bouton ne permettait de les retirer.
 */
export function ActiveFilters({
  filters,
  path,
  params,
}: {
  filters: readonly ActiveFilter[];
  path: string;
  params: SearchParamsLike;
}) {
  if (filters.length === 0) return null;
  return (
    <>
      <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
      {filters.map((filter) => (
        <Link
          key={filter.param}
          href={hrefWith(path, params, { [filter.param]: null, page: null })}
          scroll={false}
          aria-label={`Retirer le filtre ${filter.label}`}
          className="hit-44 inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-pale px-2 py-1 text-badge whitespace-nowrap text-accent transition-colors duration-(--dur-fast) ease-out hover:text-text"
        >
          {filter.label}
          <Icon name="close" size={12} />
        </Link>
      ))}
    </>
  );
}

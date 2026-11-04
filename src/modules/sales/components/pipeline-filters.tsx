"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PAGE_PARAM } from "@/components/ui/data-table";
import { FilterBar, FilterChip, SearchField } from "@/components/ui/filter-bar";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { hrefWith } from "@/lib/url-state";
import { FilterSelect } from "@/modules/crm/components/filter-select";
import { INACTIVE_DEFAULT_DAYS, INACTIVE_OPTIONS } from "./opportunity-view";

const FILTER_PARAMS = ["responsable", "origine", "inactives", "q", "etape", "archivees"] as const;

/**
 * Même dessin que `FilterChip`, mais une pastille active se retire au clic, et « Tout » lève tous les
 * filtres. `FilterChip` ne sait agir que sur un seul paramètre : l'écran 03 en mêle plusieurs.
 */
function ToggleChip({
  active,
  patch,
  children,
}: {
  active: boolean;
  patch: Record<string, string | null>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <Link
      href={hrefWith(pathname, searchParams, { ...patch, [PAGE_PARAM]: null })}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "hit-44 inline-flex shrink-0 items-center rounded-full px-2 py-1 text-badge whitespace-nowrap transition-colors duration-(--dur-fast) ease-out",
        active ? "bg-accent-pale text-accent" : "bg-surface-raised text-muted hover:text-text",
      )}
    >
      {children}
    </Link>
  );
}

function firstName(fullName: string) {
  return fullName.split(" ")[0] ?? fullName;
}

export interface PipelineFilterOptions {
  owners: readonly { id: string; fullName: string }[];
  sources: readonly string[];
  stages: readonly { value: string; label: string }[];
}

/** Rangée de filtres de l'écran 03 : tout, responsables, origines, plus les affaires sans activité. */
export function PipelineFilterChips({ owners, sources }: PipelineFilterOptions) {
  const searchParams = useSearchParams();
  const owner = searchParams.get("responsable");
  const source = searchParams.get("origine");
  const inactive = searchParams.get("inactives");
  const none = !FILTER_PARAMS.some((param) => searchParams.get(param));
  const clearAll = Object.fromEntries(FILTER_PARAMS.map((param) => [param, null]));

  return (
    <FilterBar label="Filtrer les affaires" className="min-w-0 sm:flex-1">
      <ToggleChip active={none} patch={clearAll}>
        Tout
      </ToggleChip>
      {owners.map((member) => (
        <ToggleChip
          key={member.id}
          active={owner === member.id}
          patch={{ responsable: owner === member.id ? null : member.id }}
        >
          {firstName(member.fullName)}
        </ToggleChip>
      ))}
      {sources.map((value) => (
        <ToggleChip
          key={value}
          active={source === value}
          patch={{ origine: source === value ? null : value }}
        >
          Origine : {value.toLowerCase()}
        </ToggleChip>
      ))}
      <ToggleChip
        active={inactive !== null}
        patch={{ inactives: inactive ? null : String(INACTIVE_DEFAULT_DAYS) }}
      >
        {inactive ? `Sans activité depuis ${inactive} j` : "Sans activité"}
      </ToggleChip>
    </FilterBar>
  );
}

/** Bascule Kanban / Liste, portée par l'URL. */
export function PipelineViewSwitch() {
  return (
    <div role="group" aria-label="Affichage" className="flex shrink-0 items-center gap-2">
      <FilterChip param="vue">Kanban</FilterChip>
      <FilterChip param="vue" value="liste">
        Liste
      </FilterChip>
    </div>
  );
}

/** « Filtrer » : les filtres qui ne tiennent pas dans la rangée de pastilles. */
export function PipelineFilterPanel({
  owners,
  sources,
  stages,
  showStage,
  canSeeArchived,
}: PipelineFilterOptions & { showStage: boolean; canSeeArchived: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = FILTER_PARAMS.filter((param) => searchParams.get(param)).length;
  const clearAll = Object.fromEntries(FILTER_PARAMS.map((param) => [param, null]));

  return (
    <Popover
      label="Filtrer les affaires"
      placement="bottom-end"
      trigger={(props) => (
        <Button {...props}>{active > 0 ? `Filtrer · ${active}` : "Filtrer"}</Button>
      )}
    >
      {() => (
        <div className="flex w-[min(320px,calc(100vw-32px))] flex-col gap-3 p-4">
          <SearchField param="q" label="Chercher une affaire ou un client" className="sm:w-full" />
          <FilterSelect
            param="responsable"
            label="Responsable"
            allLabel="Tous les responsables"
            className="w-full"
            options={owners.map((owner) => ({ value: owner.id, label: owner.fullName }))}
          />
          <FilterSelect
            param="origine"
            label="Origine"
            allLabel="Toutes les origines"
            className="w-full"
            options={sources.map((value) => ({ value, label: value }))}
          />
          {showStage ? (
            <FilterSelect
              param="etape"
              label="Étape"
              allLabel="Toutes les étapes"
              className="w-full"
              options={stages}
            />
          ) : null}
          <FilterSelect
            param="inactives"
            label="Sans activité depuis"
            allLabel="Sans filtre d'activité"
            className="w-full"
            options={INACTIVE_OPTIONS.map((days) => ({
              value: String(days),
              label: `Sans activité depuis ${days} j`,
            }))}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {canSeeArchived ? (
              <ToggleChip
                active={searchParams.get("archivees") === "1"}
                patch={{ archivees: searchParams.get("archivees") === "1" ? null : "1" }}
              >
                Archivées
              </ToggleChip>
            ) : (
              <span />
            )}
            <Link
              href={hrefWith(pathname, searchParams, { ...clearAll, [PAGE_PARAM]: null })}
              scroll={false}
              className="hit-44 text-sm font-medium text-accent underline-offset-4 hover:underline"
            >
              Effacer les filtres
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}

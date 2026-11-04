"use client";

import { useEffect, useState } from "react";
import { loadCompanyLinksAction } from "../finance.actions";
import type { CompanyLinks } from "../finance.service";

const EMPTY: CompanyLinks = {
  projects: [],
  contracts: [],
  quotes: [],
  sites: [],
  scheduleItems: [],
  documents: [],
};

/**
 * Ajoute à une liste la valeur déjà enregistrée quand elle n'y figure plus (projet archivé, au-delà de
 * la limite de la liste). Sans cela, le champ afficherait « Aucun » et l'enregistrement effacerait le
 * lien sans que personne l'ait demandé.
 */
export function withCurrent<T extends { id: string; label: string }>(
  list: readonly T[],
  current: { id: string | null | undefined; label: string | null | undefined } | null,
): readonly { id: string; label: string }[] {
  if (!current?.id || list.some((item) => item.id === current.id)) return list;
  return [...list, { id: current.id, label: current.label ?? "Élément archivé" }];
}

/** Projets, contrats, échéances… du client choisi dans un formulaire. */
export function useCompanyLinks(companyId: string): { links: CompanyLinks; loading: boolean } {
  const [state, setState] = useState<{ companyId: string; links: CompanyLinks } | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    void loadCompanyLinksAction(companyId).then((links) => {
      if (!cancelled) setState({ companyId, links: links ?? EMPTY });
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (!companyId) return { links: EMPTY, loading: false };
  // Les listes du client précédent ne restent jamais affichées.
  if (state?.companyId !== companyId) return { links: EMPTY, loading: true };
  return { links: state.links, loading: false };
}

import { ConflictError } from "@/server/errors";

/**
 * Machines à états du domaine (`docs/domain-model.md` §4) : une table de transitions autorisées
 * par domaine, dans `src/modules/<domaine>/<x>.status.ts`. Fichier sans dépendance serveur :
 * l'interface peut s'en servir pour griser une action, le service reste seul à faire foi.
 */
export type TransitionTable<TStatus extends string> = Readonly<Record<TStatus, readonly TStatus[]>>;

export function canTransition<TStatus extends string>(
  table: TransitionTable<TStatus>,
  from: TStatus,
  to: TStatus,
): boolean {
  return table[from].includes(to);
}

/** Lève une `ConflictError` si la transition n'est pas autorisée. */
export function assertTransition<TStatus extends string>(
  table: TransitionTable<TStatus>,
  from: TStatus,
  to: TStatus,
  labels?: Readonly<Record<TStatus, string>>,
): void {
  if (canTransition(table, from, to)) return;
  const fromLabel = labels?.[from] ?? from;
  const toLabel = labels?.[to] ?? to;
  throw new ConflictError(`Passage de « ${fromLabel} » à « ${toLabel} » impossible.`);
}

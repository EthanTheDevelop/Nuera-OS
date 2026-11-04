/** Mémoire de session de la cascade d'arrivée : sessionStorage, jamais envoyée au serveur. */
export const BUILD_STORAGE_KEY = "nuera:build";

interface BuildMemory {
  shell?: boolean;
  pages?: Record<string, boolean>;
}

function read(): BuildMemory {
  try {
    return JSON.parse(sessionStorage.getItem(BUILD_STORAGE_KEY) ?? "{}") as BuildMemory;
  } catch {
    return {};
  }
}

function write(memory: BuildMemory): void {
  try {
    sessionStorage.setItem(BUILD_STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Stockage indisponible (navigation privée stricte) : la cascade rejouera, sans gravité.
  }
}

export function isPageSeen(key: string): boolean {
  return read().pages?.[key] === true;
}

export function markPageSeen(key: string): void {
  const memory = read();
  write({ ...memory, pages: { ...memory.pages, [key]: true } });
}

/** Instant où la page courante a commencé à se construire (`null` : déjà vue, pas de cascade). */
let pageBuildStartedAt: number | null = null;

export function startPageBuild(seen: boolean, hardLoad: boolean): void {
  pageBuildStartedAt = seen ? null : hardLoad ? 0 : performance.now();
}

/** Temps écoulé depuis le début de la construction ; `null` si aucune cascade n'est en cours. */
export function pageBuildElapsedMs(): number | null {
  return pageBuildStartedAt === null ? null : performance.now() - pageBuildStartedAt;
}

export function isShellSeen(): boolean {
  return read().shell === true;
}

export function markShellSeen(): void {
  write({ ...read(), shell: true });
}

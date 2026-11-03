/**
 * Protection contre les redirections ouvertes : n'accepte qu'un chemin interne
 * (« /companies?page=2 »), jamais une URL absolue ni « //domaine » ou « /\domaine ».
 */
export function safeRedirectPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Caractères de contrôle (ex. tabulation, retour ligne) ignorés par certains navigateurs.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (value === "/login" || value.startsWith("/login?")) return fallback;
  return value;
}

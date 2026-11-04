import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_PREFIX } from "@/server/auth/cookies";

/**
 * Proxy Next.js (ex-middleware), exécuté avant chaque page :
 *
 * 1. Content-Security-Policy stricte à nonce (une valeur aléatoire par requête).
 * 2. Redirection OPTIMISTE vers /login si aucun cookie de session n'est présent.
 *    Ce n'est PAS le contrôle d'accès : la session est vérifiée en base par
 *    chaque page et chaque service (`src/server/auth/session.ts`).
 */
const PUBLIC_PATHS = new Set([
  "/login",
  "/login/reinitialiser",
  // Portail client : page de connexion par lien et lien expiré (C2, C9).
  "/espace/connexion",
  "/espace/lien-expire",
]);

function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // `unsafe-eval` : uniquement en développement (outils de débogage React).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Feuilles et balises <style> : fichiers de l'application ou nonce de la requête. Sert aussi
    // aux navigateurs qui ne connaissent pas `style-src-elem`. En développement seulement, les
    // outils de Next injectent leurs <style> sans nonce (`unsafe-inline` serait ignoré à côté d'un
    // nonce, d'où son remplacement).
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    `style-src-elem 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // Attributs `style="…"` du HTML serveur : autorisés, c'est le plus petit assouplissement qui
    // marche. Ils portent les valeurs dynamiques rendues côté serveur (jauges, barres, cascade) et
    // le CSS de Next ; un nonce ne peut pas s'y appliquer. Ils ne peuvent ni exécuter de script ni
    // charger de ressource (`url()` reste borné par `img-src` et `font-src`). `<style>` et
    // feuilles restent verrouillés par le nonce juste au-dessus.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Galerie de composants : développement uniquement. La page répond 404 ailleurs. */
function isDevGallery(pathname: string): boolean {
  return process.env.NODE_ENV === "development" && pathname.startsWith("/dev/");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    !PUBLIC_PATHS.has(pathname) &&
    !isDevGallery(pathname) &&
    !getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX })
  ) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Tout sauf l'API (auth, healthcheck), les fichiers statiques, le logo et les icônes.
      source: "/((?!api|_next/static|_next/image|brand/|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

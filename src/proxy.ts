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
const PUBLIC_PATHS = new Set(["/login"]);

function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // `unsafe-eval` : uniquement en développement (outils de débogage React).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
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

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    !PUBLIC_PATHS.has(pathname) &&
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
      // Tout sauf l'API (auth, healthcheck), les fichiers statiques et les icônes.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

import type { NextConfig } from "next";

/**
 * En-têtes de sécurité appliqués à toutes les réponses.
 * La Content-Security-Policy (à nonce, donc dynamique) est posée par `src/proxy.ts`.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Outil interne : ne doit jamais être indexé.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  // Ignoré par les navigateurs en HTTP (local) ; effectif derrière le TLS de Coolify.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Image Docker minimale pour le déploiement (Coolify).
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

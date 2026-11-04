import type { Metadata } from "next";
import { JetBrains_Mono, Outfit } from "next/font/google";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { BuildScript } from "@/components/motion/build-script";
import { MotionProvider } from "@/components/motion/motion-provider";
import { ToastProvider } from "@/components/ui/toast";
import { readAppearance } from "@/lib/appearance";
import { cn } from "@/lib/cn";
import "./globals.css";

/**
 * Polices servies par l'application : `next/font` les télécharge au build et les place dans
 * `/_next/static`. Aucun appel à Google au moment de l'exécution, la CSP `font-src 'self'` tient.
 */
const outfit = Outfit({
  subsets: ["latin", "latin-ext"],
  variable: "--font-outfit",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Nuera OS", template: "%s · Nuera OS" },
  description: "Plateforme interne de pilotage de Nuera Studio.",
  // Outil interne : jamais indexé.
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Lire la requête rend toutes les pages dynamiques : une CSP à nonce l'exige, car un HTML
  // pré-rendu au build ne pourrait pas porter le nonce de chaque requête.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const cookieStore = await cookies();
  const appearance = readAppearance((name) => cookieStore.get(name)?.value);

  return (
    <html
      lang="fr"
      data-theme={appearance.theme}
      data-accent={appearance.accent}
      data-density={appearance.density}
      // Le script de <head> pose `data-page-seen` et résout le thème `auto` avant React.
      suppressHydrationWarning
      className={cn(outfit.variable, jetbrainsMono.variable)}
    >
      <head>
        <BuildScript nonce={nonce} />
      </head>
      <body className="bg-bg text-text">
        <MotionProvider nonce={nonce}>
          <ToastProvider>{children}</ToastProvider>
        </MotionProvider>
      </body>
    </html>
  );
}

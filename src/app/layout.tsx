import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Nuera OS", template: "%s · Nuera OS" },
  description: "Plateforme interne de pilotage de Nuera Studio.",
  // Outil interne : jamais indexé.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="font-sans text-sm antialiased">{children}</body>
    </html>
  );
}

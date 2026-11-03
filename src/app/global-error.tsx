"use client";

import "./globals.css";

/** Dernier filet : erreur dans le layout racine. Aucun détail technique affiché. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body className="font-sans text-sm">
        <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-xl font-semibold">Nuera OS est momentanément indisponible</h1>
          {error.digest ? <p className="text-ink-muted">Référence : {error.digest}</p> : null}
          <button type="button" onClick={reset} className="underline underline-offset-4">
            Réessayer
          </button>
        </main>
      </body>
    </html>
  );
}

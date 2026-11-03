import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-xl font-semibold">Page introuvable</h1>
      <p className="text-ink-muted">Cette page n&apos;existe pas.</p>
      <Link href="/" className="text-accent underline underline-offset-4">
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}

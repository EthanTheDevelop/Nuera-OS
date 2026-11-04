import Link from "next/link";
import { Icon } from "@/components/ui/icon";

/** Filtre actif, retiré d'un clic : `href` est la même adresse sans ce filtre. */
export function ActiveFilter({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={`Retirer le filtre ${children}`}
      className="hit-44 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-pale px-2 py-1 text-badge whitespace-nowrap text-accent"
    >
      {children}
      <Icon name="close" size={12} />
    </Link>
  );
}

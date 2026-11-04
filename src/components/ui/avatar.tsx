import { cn } from "@/lib/cn";

/** Tailles relevées dans Figma. */
export type AvatarSize = 22 | 24 | 26 | 28 | 32 | 36 | 40 | 56 | 64;

/** Figma garde les initiales à 13 px quelle que soit la taille, sauf pour les grands avatars. */
const SIZES: Record<AvatarSize, string> = {
  22: "size-[22px] text-[11px] leading-none font-semibold",
  24: "size-6 text-avatar",
  26: "size-[26px] text-avatar",
  28: "size-7 text-avatar",
  32: "size-8 text-avatar",
  36: "size-9 text-avatar",
  40: "size-10 text-avatar",
  56: "size-14 text-[18px] leading-none font-semibold",
  64: "size-16 text-[20px] leading-none font-semibold",
};

/** Initiales d'un nom complet : `Nezar Zakaria` → `NZ`. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s'’-]+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toLocaleUpperCase("fr-FR");
}

/**
 * Avatar à initiales (Figma 57:125). `name` donne les initiales et le nom accessible ;
 * `initials` les impose. Sans `label`, il est décoratif (le nom figure déjà à côté).
 */
export function Avatar({
  name,
  initials,
  size = 36,
  label,
  className,
}: {
  name?: string;
  initials?: string;
  size?: AvatarSize;
  /** Nom annoncé si l'avatar est seul à porter l'information. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-accent-pale text-ink",
        SIZES[size],
        className,
      )}
    >
      {initials ?? (name ? initialsOf(name) : "")}
    </span>
  );
}

/** Pile d'avatars qui se chevauchent (-10 en 36, -8 en 28, comme les maquettes). */
export function AvatarStack({
  people,
  size = 36,
  max,
  className,
}: {
  people: readonly { name: string; initials?: string }[];
  size?: AvatarSize;
  max?: number;
  className?: string;
}) {
  const shown = max ? people.slice(0, max) : people;
  const hidden = people.length - shown.length;
  const label = people.map((person) => person.name).join(", ");
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      className={cn(
        "inline-flex items-center",
        size >= 36 ? "-space-x-2.5" : "-space-x-2",
        className,
      )}
    >
      {shown.map((person) => (
        <Avatar key={person.name} name={person.name} initials={person.initials} size={size} />
      ))}
      {hidden > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full bg-surface-raised font-semibold text-muted",
            SIZES[size],
          )}
        >
          +{hidden}
        </span>
      ) : null}
    </span>
  );
}

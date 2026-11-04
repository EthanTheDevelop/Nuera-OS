import Image from "next/image";

const LOGOS = {
  "os-paper": { src: "/brand/nuera-os-papier.svg", width: 168, height: 28 },
  "os-ink": { src: "/brand/nuera-os-encre.svg", width: 168, height: 28 },
} as const;

/**
 * Logo Nuera OS (tokens §8). Fichier unique dans `public/brand` : Figma prévient que le logo
 * définitif n'est pas encore choisi, seul ce fichier changera. `<img>` plutôt que SVG en ligne :
 * les identifiants de masque des fichiers entreraient en collision dans une même page.
 */
export function Logo({
  variant = "os-paper",
  width = 168,
  className,
}: {
  variant?: keyof typeof LOGOS;
  /** Largeur rendue. 168 en barre latérale, 83 dans la capsule client. */
  width?: number;
  className?: string;
}) {
  const logo = LOGOS[variant];
  return (
    <Image
      src={logo.src}
      alt="Nuera OS"
      width={width}
      height={Math.round((width * logo.height) / logo.width)}
      unoptimized
      priority
      className={className}
    />
  );
}

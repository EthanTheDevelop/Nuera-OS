/** `+33612345678` devient `06 12 34 56 78`. Un numéro étranger reste au format international. */
function toDisplay(phone: string): string {
  if (!phone.startsWith("+33") || phone.length !== 12) return phone;
  const national = `0${phone.slice(3)}`;
  return national.replace(/(\d{2})(?=\d)/g, "$1 ");
}

/**
 * Téléphone lisible pour l'équipe, qui a déjà le droit de lire la fiche : un lien `tel:`.
 * (Ancien masquage `+11 •• 89` retiré : il cachait un numéro que le membre peut de toute façon voir.)
 */
export function PhoneReveal({ phone }: { phone: string }) {
  return (
    <a href={`tel:${phone}`} className="tabular hit-44 hover:underline hover:underline-offset-4">
      {toDisplay(phone)}
    </a>
  );
}

"use client";

import { useState } from "react";

/** `+33612345678` devient `06 12 34 56 78`. Un numéro étranger reste au format international. */
function toDisplay(phone: string): string {
  if (!phone.startsWith("+33") || phone.length !== 12) return phone;
  const national = `0${phone.slice(3)}`;
  return national.replace(/(\d{2})(?=\d)/g, "$1 ");
}

function mask(display: string): string {
  const groups = display.split(" ");
  if (groups.length < 3) return `${display.slice(0, 3)} •• ${display.slice(-2)}`;
  return groups
    .map((group, index) =>
      index === 0 || index === groups.length - 1 ? group : "•".repeat(group.length),
    )
    .join(" ");
}

/** Téléphone masqué sur la fiche (écran 04), révélé à la demande. */
export function PhoneReveal({ phone }: { phone: string }) {
  const [shown, setShown] = useState(false);
  const display = toDisplay(phone);
  if (shown) {
    return (
      <a href={`tel:${phone}`} className="tabular hit-44 hover:underline hover:underline-offset-4">
        {display}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setShown(true)}
      aria-label={`Afficher le numéro, masqué : ${mask(display)}`}
      className="tabular hit-44 text-left hover:underline hover:underline-offset-4"
    >
      {mask(display)}
    </button>
  );
}

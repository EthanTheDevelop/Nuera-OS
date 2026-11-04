/**
 * Écriture des exports CSV. Point-virgule et BOM : un Excel français ouvre le fichier sans réglage.
 * Une cellule commençant par `=`, `+`, `-` ou `@` est préfixée d'une apostrophe : un fichier partagé
 * ne doit pas exécuter de formule (nom de client saisi ou importé). Un simple nombre négatif reste
 * un nombre : l'apostrophe en ferait du texte, et le total d'une colonne d'avoirs serait faux.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-\d+(,\d+)?$/;

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value).replace(".", ",");
  const safe = FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** `123450` donne le nombre `1234,50` en euros, lisible et calculable dans un tableur. */
export function centsToCsvEuros(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

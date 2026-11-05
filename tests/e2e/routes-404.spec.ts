import { expect, test } from "@playwright/test";

/**
 * Une fiche inconnue répond un vrai 404 : un `loading.tsx` au-dessus de la page le changerait en 200.
 * Et aucune de ces pages ne journalise d'erreur React dans la console.
 *
 * Exige une base de développement remplie et un compte d'associé :
 * E2E_ADMIN_EMAIL et E2E_ADMIN_PASSWORD (`npm run db:seed` les imprime).
 */
const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;

test.skip(!email || !password, "E2E_ADMIN_EMAIL et E2E_ADMIN_PASSWORD requis");
test.describe.configure({ timeout: 300_000 });

const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const ROUTES = [
  "clients",
  "clients/contacts",
  "contrats",
  "devis",
  "devis/catalogue",
  "documents",
  "documents/connaissances",
  "documents/modeles",
  "equipe",
  "equipe/missions",
  "finances/echeancier",
  "finances/factures",
  "finances/imports",
  "finances/rentabilite/projets",
  "messages",
  "pipeline",
  "projets",
  "sites",
  "support",
];

test("chaque fiche inconnue répond 404, sans erreur dans la console", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/e-mail/i).fill(email ?? "");
  await page.getByLabel(/mot de passe/i).fill(password ?? "");
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page).not.toHaveURL(/\/login/);

  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      errors.push(message.text());
    }
  });

  for (const path of [
    ...ROUTES.map((route) => `/${route}/${UNKNOWN}`),
    `/devis/${UNKNOWN}/modifier`,
    `/devis/${UNKNOWN}/apercu`,
    "/finances/rentabilite/inconnu",
  ]) {
    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response?.status(), path).toBe(404);
  }
  expect(errors).toEqual([]);
});

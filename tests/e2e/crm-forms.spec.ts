import { expect, test } from "@playwright/test";

/**
 * Formulaires du CRM : ce que seul un vrai navigateur peut révéler (valeurs initiales d'un `select`
 * rempli après coup, remise à zéro du formulaire par React). Aucune écriture : les envois sont
 * refusés par la validation, et les lignes du jeu d'essai ne partent jamais vers Twenty.
 *
 * Exige une base de développement remplie et un compte d'associé :
 * E2E_ADMIN_EMAIL et E2E_ADMIN_PASSWORD (`npm run db:seed` les imprime).
 */
const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;

test.skip(!email || !password, "E2E_ADMIN_EMAIL et E2E_ADMIN_PASSWORD requis");

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/e-mail/i).fill(email ?? "");
  await page.getByLabel(/mot de passe/i).fill(password ?? "");
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
});

test("modifier une affaire montre son contact : l'enregistrer ne l'efface pas", async ({
  page,
}) => {
  await page.goto("/clients/contacts?q=Faure");
  await page
    .getByRole("link", { name: /Jules Faure/ })
    .first()
    .click();
  await page.getByRole("link", { name: "Cabinet Faure Avocats" }).click();
  await page.getByRole("link", { name: "Refonte du site du cabinet" }).first().click();
  await expect(page).toHaveURL(/\/pipeline\//);
  await page.getByRole("button", { name: "Modifier", exact: true }).first().click();

  const contact = page.getByLabel("Contact");
  await expect(contact).toBeEnabled();
  await expect(contact.locator("option:checked")).toHaveText("Jules Faure");
});

test("une erreur de validation ne perd pas les cases cochées d'un contact", async ({ page }) => {
  await page.goto("/clients/contacts?q=Faure");
  await page
    .getByRole("link", { name: /Jules Faure/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Modifier" }).first().click();

  const technical = page.getByLabel("Technique");
  await expect(technical).not.toBeChecked();
  await technical.check();
  await page.getByLabel("Téléphone").fill("abc");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText(/Numéro invalide/).first()).toBeVisible();
  await expect(page.getByLabel("Téléphone")).toHaveValue("abc");
  await expect(technical).toBeChecked();
});

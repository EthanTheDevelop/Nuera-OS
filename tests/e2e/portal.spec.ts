import { expect, test } from "@playwright/test";

/**
 * Portail client, côté public. JavaScript coupé pour la connexion : un envoi avant l'hydratation ne
 * doit pas placer l'adresse dans l'URL. Aucune écriture : le POST natif ne fait que rendre la page.
 */
test.describe("sans JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("C2 : l'adresse ne passe pas dans l'URL", async ({ page }) => {
    await page.goto("/espace/connexion");
    await page.getByLabel(/adresse e-mail/i).fill("personne@exemple.test");
    await page.getByRole("button", { name: /recevoir mon lien/i }).click();
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).not.toContain("email=");
    expect(page.url()).not.toContain("personne");
  });
});

test("sans session, l'espace mène à sa propre connexion, pas à celle de l'équipe", async ({
  page,
}) => {
  await page.goto("/espace");
  await expect(page).toHaveURL(/\/espace\/connexion$/);
  await expect(page.getByRole("heading", { name: "Connexion à votre espace" })).toBeVisible();
  await page.goto("/espace/documents");
  await expect(page).toHaveURL(/\/espace\/connexion$/);
});

test("C9 : un lien invalide mène à la page du lien expiré", async ({ page }) => {
  await page.goto(
    "/api/auth/magic-link/verify?token=inexistant&callbackURL=%2Fespace&errorCallbackURL=%2Fespace%2Flien-expire",
  );
  await expect(page).toHaveURL(/\/espace\/lien-expire/);
  await expect(page.getByRole("heading", { name: "Ce lien a expiré" })).toBeVisible();
  await page.getByRole("link", { name: "Recevoir un nouveau lien" }).click();
  await expect(page).toHaveURL(/\/espace\/connexion$/);
});

test("C2 : même réponse, que l'adresse existe ou non, et aucune fuite", async ({
  page,
  request,
}) => {
  await page.goto("/espace/connexion");
  await page.getByLabel(/adresse e-mail/i).fill("pas-d-espace@exemple.test");
  await page.getByRole("button", { name: /recevoir mon lien/i }).click();
  await expect(page.getByText(/le lien arrive dans quelques instants/i)).toBeVisible();

  await page.getByLabel(/adresse e-mail/i).fill("pas-une-adresse");
  await page.getByRole("button", { name: /recevoir mon lien/i }).click();
  await expect(page.getByText(/ne semble pas valide/i)).toBeVisible();

  const archive = await request.get("/espace/documents/archive", { maxRedirects: 0 });
  expect(archive.status()).toBe(307);
});

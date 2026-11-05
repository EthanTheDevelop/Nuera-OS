import { expect, test } from "@playwright/test";

/**
 * Un envoi avant l'hydratation part en natif : sans `method="post"`, le navigateur place le mot de
 * passe dans l'adresse (historique, journaux, en-tête Referer). JavaScript est coupé pour le prouver.
 * Aucune écriture : un POST sur ces pages ne fait que les rendre à nouveau.
 */
test.use({ javaScriptEnabled: false });

const SECRET = "ne-doit-pas-sortir-1234";

test("connexion : ni l'adresse ni le mot de passe ne passent dans l'URL", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/e-mail/i).fill("camille@seed.nuera.test");
  await page.getByLabel(/mot de passe/i).fill(SECRET);

  const [request, response] = await Promise.all([
    page.waitForRequest((r) => r.isNavigationRequest() && r.frame() === page.mainFrame()),
    page.waitForResponse((r) => r.request().isNavigationRequest()),
    page.getByRole("button", { name: /se connecter/i }).click(),
  ]).then(([req, res]) => [req, res] as const);

  expect(request.method()).toBe("POST");
  expect(response.status()).toBeLessThan(500);
  expect(page.url()).not.toContain(SECRET);
  expect(page.url()).not.toContain("password=");
  expect(page.url()).not.toContain("email=");
  await expect(page.getByLabel(/mot de passe/i)).toBeVisible();
});

test("nouveau mot de passe : rien dans l'URL en dehors du jeton", async ({ page }) => {
  await page.goto("/login/reinitialiser?token=jeton-essai");
  await page.getByLabel("Nouveau mot de passe").fill(SECRET);
  await page.getByLabel(/le même/i).fill(SECRET);

  const [request, response] = await Promise.all([
    page.waitForRequest((r) => r.isNavigationRequest() && r.frame() === page.mainFrame()),
    page.waitForResponse((r) => r.request().isNavigationRequest()),
    page.getByRole("button", { name: /enregistrer/i }).click(),
  ]).then(([req, res]) => [req, res] as const);

  expect(request.method()).toBe("POST");
  expect(response.status()).toBeLessThan(500);
  expect(page.url()).not.toContain(SECRET);
  expect(page.url()).not.toContain("password=");
});

test("un POST direct sur les pages d'authentification répond sans erreur serveur", async ({
  request,
}) => {
  const login = await request.post("/login", {
    form: { email: "camille@seed.nuera.test", password: SECRET },
  });
  expect(login.status()).toBeLessThan(500);
  await expect(login.text()).resolves.not.toContain(SECRET);

  const reset = await request.post("/login/reinitialiser?token=jeton-essai", {
    form: { password: SECRET, confirmation: SECRET },
  });
  expect(reset.status()).toBeLessThan(500);
  await expect(reset.text()).resolves.not.toContain(SECRET);
});

test("tout formulaire d'authentification rendu au serveur est en POST", async ({ page }) => {
  for (const path of ["/login", "/login/reinitialiser?token=jeton-essai"]) {
    await page.goto(path);
    const forms = page.locator("form");
    await expect(forms.first()).toBeVisible();
    for (const form of await forms.all()) {
      await expect(form).toHaveAttribute("method", "post");
    }
  }
});

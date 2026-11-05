import { expect, test, type Page } from "@playwright/test";

/**
 * Chiffres qui roulent : sans sa feuille de style, NumberFlow affiche chaque chiffre comme une bande
 * « 0123456789 ». Cause passée : le layout racine, rejoué à la connexion sans recharger la page,
 * apportait le nonce d'une autre requête, que la CSP du document refuse.
 *
 * Le développement relâche `style-src` : ce contrôle n'a toute sa valeur qu'en production, avec
 * E2E_BASE_URL sur `next start`. Exige une base remplie, E2E_ADMIN_EMAIL et E2E_ADMIN_PASSWORD.
 */
const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };

/** Une ligne par chiffre rendu de travers (bande de chiffres, style refusé, sortie du cadre). */
const brokenNumbers = (page: Page) =>
  page.locator("number-flow-react").evaluateAll((hosts) =>
    hosts.flatMap((host) => {
      const root = host.shadowRoot;
      const digits = root?.querySelectorAll(".digit").length ?? 0;
      const visible = [...(root?.querySelectorAll<HTMLElement>(".digit__num") ?? [])].filter(
        (digit) => getComputedStyle(digit).display !== "none",
      ).length;
      const blocked = [...(root?.querySelectorAll("style") ?? [])].some((style) => !style.sheet);
      const box = host.getBoundingClientRect();
      const frame = host.closest("article")?.getBoundingClientRect();
      const overflows = frame ? box.right > frame.right + 1 : false;
      return blocked || overflows || (visible > 0 && visible !== digits)
        ? [`${digits} chiffres, ${visible} visibles, ${Math.round(box.width)} px`]
        : [];
    }),
  );

test.describe("chiffres", () => {
  test.skip(!admin.email || !admin.password, "E2E_ADMIN_EMAIL et E2E_ADMIN_PASSWORD requis");
  test.use({ viewport: { width: 1440, height: 1120 } });

  test("après la connexion, sans recharger la page, chaque chiffre affiche sa valeur", async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("Content Security Policy")) violations.push(message.text());
    });

    await page.goto("/login");
    await page.getByLabel(/e-mail/i).fill(admin.email ?? "");
    await page.getByLabel(/mot de passe/i).fill(admin.password ?? "");
    await page.evaluate(() => {
      (window as unknown as { sameDocument: boolean }).sameDocument = true;
    });
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("number-flow-react").first()).toBeAttached();
    await expect.poll(() => brokenNumbers(page)).toEqual([]);

    for (const path of ["/finances", "/contrats", "/temps", "/reporting", "/"]) {
      await page.locator(`a[href="${path}"]`).first().click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(path);
      await expect(page.locator("number-flow-react").first()).toBeAttached();
      await expect.poll(() => brokenNumbers(page)).toEqual([]);
    }

    // Le scénario n'a de sens que si le document est resté celui de la page de connexion.
    expect(
      await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument),
    ).toBe(true);
    expect(violations).toEqual([]);
  });
});

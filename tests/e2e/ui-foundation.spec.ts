import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * Socle d'interface, en vrai navigateur, sur la galerie `/dev/ui` (développement uniquement) :
 * aucune erreur de console, pas de défilement horizontal, réduction des animations,
 * clavier sur les composants qui en dépendent.
 */

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  return problems;
}

const PAGES = [
  "/login",
  "/dev/ui",
  "/dev/ui/clients",
  "/dev/ui/projet",
  "/dev/ui/tableau",
  "/dev/ui/client",
];

for (const path of PAGES) {
  test(`${path} : pas d'erreur de console, pas de défilement horizontal`, async ({ page }) => {
    const problems = collectProblems(page);
    await page.goto(path, { waitUntil: "networkidle" });
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    expect(problems).toEqual([]);
  });
}

const ANIMATED = [
  ".anim-frame",
  ".anim-header",
  ".anim-content",
  ".anim-data",
  ".anim-grow-x",
  ".anim-grow-y",
  ".anim-segment",
  ".anim-wipe",
];

/** Styles calculés plutôt que `getAnimations()` : l'animation peut déjà être terminée. */
function readAnimationStyles(page: Page) {
  return page.evaluate((selectors) => {
    return selectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [];
      const style = getComputedStyle(element);
      return [
        {
          selector,
          name: style.animationName,
          duration: style.animationDuration,
          delay: style.animationDelay,
        },
      ];
    });
  }, ANIMATED);
}

test("sans réglage particulier, l'entrée type joue avec flou et cascade", async ({ page }) => {
  await page.goto("/dev/ui", { waitUntil: "domcontentloaded" });
  const styles = await readAnimationStyles(page);
  const content = styles.find((style) => style.selector === ".anim-content");
  expect(content).toMatchObject({ name: "nu-enter", duration: "0.35s" });
  const bar = styles.find((style) => style.selector === ".anim-grow-x");
  expect(bar).toMatchObject({ name: "nu-grow-x", duration: "0.6s" });
});

test.describe("réduire les animations", () => {
  test.use({ reducedMotion: "reduce" });

  test("toute entrée devient un fondu de 150 ms, sans délai", async ({ page }) => {
    await page.goto("/dev/ui", { waitUntil: "domcontentloaded" });
    const styles = await readAnimationStyles(page);
    expect(styles.length).toBeGreaterThan(6);
    for (const style of styles) {
      expect(style, style.selector).toMatchObject({
        name: "nu-fade",
        duration: "0.15s",
        delay: "0s",
      });
    }
  });

  test("une fenêtre s'ouvre en fondu, à sa taille finale", async ({ page }) => {
    await page.goto("/dev/ui/projet", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Santé du site (M3)" }).click();
    const panel = page.getByRole("dialog").locator("[data-window]");
    await expect(panel).toBeVisible();
    const transform = await panel.evaluate((element) => getComputedStyle(element).transform);
    expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  });
});

test("connexion : identifiants refusés, message générique", async ({ page }) => {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("E-mail").fill("personne@example.test");
  await page.getByLabel("Mot de passe", { exact: true }).fill("mauvais-mot-de-passe");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("E-mail ou mot de passe incorrect.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("réinitialisation : un lien sans jeton l'explique", async ({ page }) => {
  await page.goto("/login/reinitialiser", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Ce lien n’est plus valable" })).toBeVisible();
});

test("portail : préréglage sobre, fondu de 250 ms, onglet actif visible", async ({ page }) => {
  await page.goto("/dev/ui/client", { waitUntil: "domcontentloaded" });
  const style = await page.evaluate(() => {
    const element = document.querySelector("[data-motion='client'] .anim-content");
    if (!element) return null;
    const computed = getComputedStyle(element);
    return { name: computed.animationName, duration: computed.animationDuration };
  });
  expect(style).toEqual({ name: "nu-fade", duration: "0.25s" });
  const tab = page.getByRole("link", { name: "Mon projet" });
  await expect(tab).toHaveAttribute("aria-current", "page");
  const pill = tab.locator("xpath=preceding-sibling::span");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveCSS("opacity", "1");
});

test("tiroir de navigation sur téléphone", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) >= 1024, "Écrans étroits uniquement");
  await page.goto("/dev/ui/clients", { waitUntil: "networkidle" });
  const opener = page.getByRole("button", { name: "Ouvrir la navigation" });
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav).toBeHidden();
  await opener.click();
  await expect(nav).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();
  await expect(opener).toBeFocused();
});

test.describe("mémoire de session", () => {
  test("la cascade joue une fois, pas au retour sur la page", async ({ page }) => {
    await page.goto("/dev/ui/clients", { waitUntil: "networkidle" });
    await page.waitForTimeout(100);
    await page.reload({ waitUntil: "commit" });
    await expect(page.locator("html")).toHaveAttribute("data-page-seen", "");
    await expect(page.locator("html")).toHaveAttribute("data-shell-seen", "");
  });
});

test.describe("clavier", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, "Parcours au bureau uniquement");

  test("fenêtre : focus piégé, Échap ferme, le focus revient", async ({ page }) => {
    await page.goto("/dev/ui/projet", { waitUntil: "networkidle" });
    const opener = page.getByRole("button", { name: "Santé du site (M3)" });
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Santé du site" })).toBeVisible();
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () =>
          document.activeElement === document.body ||
          Boolean(document.activeElement?.closest("dialog")),
      );
      expect(inside).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("Kanban : Espace prend, flèche déplace, Espace pose", async ({ page }) => {
    await page.goto("/dev/ui", { waitUntil: "networkidle" });
    const board = page.getByRole("group", { name: "Pipeline de démonstration" });
    const card = board.locator('[data-kanban-item="c1"]');
    await card.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    const qualified = board.locator('[data-kanban-column="qualified"]');
    await expect(qualified.locator('[data-kanban-item="c1"]')).toBeVisible();
  });

  test("Kanban : un refus du serveur remet la carte à sa place", async ({ page }) => {
    await page.goto("/dev/ui", { waitUntil: "networkidle" });
    const board = page.getByRole("group", { name: "Pipeline de démonstration" });
    await board.locator('[data-kanban-item="c4"]').focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await expect(page.getByText("Une affaire gagnée exige un montant et un client.")).toBeVisible();
    await expect(
      board.locator('[data-kanban-column="quote"] [data-kanban-item="c4"]'),
    ).toBeVisible();
  });

  test("Kanban : glisser à la souris change de colonne", async ({ page }) => {
    await page.goto("/dev/ui", { waitUntil: "networkidle" });
    const board = page.getByRole("group", { name: "Pipeline de démonstration" });
    const card = board.locator('[data-kanban-item="c2"]');
    await card.scrollIntoViewIfNeeded();
    const start = await card.boundingBox();
    const target = await board.locator('[data-kanban-column="quote"]').boundingBox();
    if (!start || !target) throw new Error("Tableau introuvable");
    await page.mouse.move(start.x + 20, start.y + 20);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 30, { steps: 3 });
    await page.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 8 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await expect(
      board.locator('[data-kanban-column="quote"] [data-kanban-item="c2"]'),
    ).toBeVisible();
  });

  test("⌘K ouvre la recherche, Échap la ferme", async ({ page }) => {
    await page.goto("/dev/ui/clients", { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Recherche globale" });
    await expect(dialog).toBeVisible();
    await page.keyboard.type("Rep");
    await expect(dialog.getByRole("option", { name: "Reporting" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("commentaire : @ ouvre la liste, Entrée insère la mention", async ({ page }) => {
    await page.goto("/dev/ui/tache", { waitUntil: "networkidle" });
    const field = page.getByRole("combobox", { name: "Ajouter un commentaire…" });
    await field.click();
    await page.keyboard.type("Merci @Eth");
    await expect(page.getByRole("option", { name: /Ethan/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue("Merci @Ethan ");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("à l’instant")).toBeVisible();
    await expect(field).toHaveValue("");
  });

  test("confirmation de production : le mot exact est exigé", async ({ page }) => {
    await page.goto("/dev/ui", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Déployer en production" }).click();
    const dialog = page.getByRole("dialog", { name: "Déployer en production ?" });
    const confirm = dialog.getByRole("button", { name: "Déployer" });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("textbox").fill("production");
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("textbox").fill("PRODUCTION");
    await expect(confirm).toBeEnabled();
  });

  test("graphique : les flèches parcourent les valeurs, annoncées au lecteur d'écran", async ({
    page,
  }) => {
    await page.goto("/dev/ui/tableau", { waitUntil: "networkidle" });
    const chart = page.getByRole("group", { name: /Chiffre d’affaires par mois/ });
    await chart.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(/JUIN 2026, Projets/)).toBeAttached();
  });
});

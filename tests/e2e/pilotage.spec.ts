import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

/**
 * Tableau de bord et reporting : ce que seul un vrai navigateur peut révéler (focus du clavier, doigt,
 * réseau coupé). Seul le scénario « Terminé » enregistre la disposition, et il la remet en place.
 *
 * Exige une base de développement remplie et un compte d'associé : E2E_ADMIN_EMAIL et
 * E2E_ADMIN_PASSWORD. E2E_VIEWER_EMAIL et E2E_VIEWER_PASSWORD ajoutent le contrôle du rôle lecture.
 */
const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };
const viewer = { email: process.env.E2E_VIEWER_EMAIL, password: process.env.E2E_VIEWER_PASSWORD };
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

type StorageState = Awaited<ReturnType<Awaited<ReturnType<Browser["newContext"]>>["storageState"]>>;

async function signIn(browser: Browser, account: typeof admin): Promise<StorageState> {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/e-mail/i).fill(account.email ?? "");
  await page.getByLabel(/mot de passe/i).fill(account.password ?? "");
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const state = await context.storageState();
  await context.close();
  return state;
}

const tileKeys = (page: Page) =>
  page
    .locator("[data-tile-key]")
    .evaluateAll((tiles) => tiles.map((tile) => (tile as HTMLElement).dataset.tileKey ?? ""));
const tileHost = (page: Page, key: string | undefined) => page.locator(`[data-tile-key="${key}"]`);
const handleOf = (page: Page, key: string | undefined) =>
  tileHost(page, key).getByRole("button", { name: /^Redimensionner la tuile/ });
const tileWidth = async (page: Page, key: string | undefined) =>
  Math.round((await tileHost(page, key).boundingBox())?.width ?? 0);

/** Tire une poignée à la souris, par à-coups, sans relâcher. */
async function dragHandle(page: Page, key: string | undefined, dx: number, dy: number) {
  const box = await handleOf(page, key).boundingBox();
  if (!box) throw new Error("Poignée hors de l'écran");
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(from.x + (dx * step) / 10, from.y + (dy * step) / 10);
  }
}

const focusedTile = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.tileKey);

test.describe.configure({ mode: "serial" });

test.describe("en associé", () => {
  test.skip(!admin.email || !admin.password, "E2E_ADMIN_EMAIL et E2E_ADMIN_PASSWORD requis");
  let state: StorageState;

  test.beforeAll(async ({ browser }) => {
    state = await signIn(browser, admin);
  });

  const open = async (browser: Browser, options: BrowserContextOptions = {}) => {
    const context = await browser.newContext({ baseURL: BASE, storageState: state, ...options });
    return { context, page: await context.newPage() };
  };

  test("édition au clavier : le focus suit, Annuler ne garde rien", async ({ browser }) => {
    const { context, page } = await open(browser, { viewport: { width: 1440, height: 1120 } });
    await page.goto("/?edition=1");
    await expect(page.locator("[data-tile-key]").first()).toBeVisible();
    const start = await tileKeys(page);
    const [first, second] = start;

    await page.locator(`[data-tile-key="${first}"]`).focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => tileKeys(page)).toEqual([second, first, ...start.slice(2)]);
    expect(await focusedTile(page)).toBe(first);

    await page.keyboard.press("Delete");
    await expect.poll(() => tileKeys(page)).toHaveLength(start.length - 1);
    // Rester dans le tableau : le clavier ne repart pas du haut de la page.
    expect(await focusedTile(page)).toBe(start[2]);

    const entries = page.locator("[data-gallery-item]");
    await entries.first().focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => tileKeys(page)).toHaveLength(start.length);
    await expect(page.locator("[data-gallery-item]:focus")).toHaveCount(1);

    await page.getByRole("link", { name: "Annuler" }).click();
    await expect(page).toHaveURL(`${BASE}/`);
    await expect.poll(() => tileKeys(page)).toEqual(start);
    await context.close();
  });

  test("réseau coupé : Terminé prévient et garde le tableau en cours", async ({ browser }) => {
    const { context, page } = await open(browser, { viewport: { width: 1440, height: 1120 } });
    await page.goto("/?edition=1");
    await expect(page.locator("[data-tile-key]").first()).toBeVisible();
    const start = await tileKeys(page);
    await page.locator(`[data-tile-key="${start[0]}"]`).focus();
    await page.keyboard.press("Delete");
    await expect.poll(() => tileKeys(page)).toHaveLength(start.length - 1);

    await context.setOffline(true);
    await page.getByRole("button", { name: "Terminé" }).click();
    await expect(page.getByText(/Enregistrement impossible/)).toBeVisible();
    expect(await tileKeys(page)).toEqual(start.slice(1));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Bonjour");
    await context.close();
  });

  test("au doigt à 390 px : la poignée déplace la tuile, sans défilement horizontal", async ({
    browser,
  }) => {
    const { context, page } = await open(browser, {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await page.goto("/?edition=1");
    const grips = page.locator('[data-tile-key] [role="presentation"]');
    await expect(grips.first()).toBeVisible();
    const start = await tileKeys(page);
    const moving = page.locator(`[data-tile-key="${start[1]}"]`);
    const target = page.locator(`[data-tile-key="${start[2]}"]`);
    await moving.evaluate((tile) =>
      window.scrollTo(0, tile.getBoundingClientRect().top + window.scrollY - 120),
    );
    const grip = await moving.locator('[role="presentation"]').boundingBox();
    const box = await target.boundingBox();
    if (!grip || !box) throw new Error("Tuile hors de l'écran");

    const cdp = await context.newCDPSession(page);
    const touch = (type: string, x?: number, y?: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: x === undefined ? [] : [{ x, y }],
      } as never);
    const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await touch("touchStart", from.x, from.y);
    for (let step = 1; step <= 15; step += 1) {
      await touch(
        "touchMove",
        from.x + ((to.x - from.x) * step) / 15,
        from.y + ((to.y - from.y) * step) / 15,
      );
      await page.waitForTimeout(40);
    }
    await touch("touchEnd");
    await expect.poll(() => tileKeys(page)).not.toEqual(start);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });

  test("la poignée n'existe qu'en édition, et un clic n'y change rien", async ({ browser }) => {
    const { context, page } = await open(browser, { viewport: { width: 1440, height: 1120 } });
    await page.goto("/");
    await expect(page.locator("[data-tile-key]").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Redimensionner la tuile/ })).toHaveCount(0);

    await page.goto("/?edition=1");
    const [key] = await tileKeys(page);
    await expect(handleOf(page, key)).toBeVisible();
    const label = await handleOf(page, key).getAttribute("aria-label");
    await handleOf(page, key).click();
    await handleOf(page, key).click();
    await page.waitForTimeout(400);
    expect(await handleOf(page, key).getAttribute("aria-label")).toBe(label);
    await context.close();
  });

  test("glisser la poignée : aperçu calé sur la grille, Annuler ne garde rien", async ({
    browser,
  }) => {
    const { context, page } = await open(browser, { viewport: { width: 1440, height: 1120 } });
    await page.goto("/?edition=1");
    const keys = await tileKeys(page);
    const key = keys.includes("revenue") ? "revenue" : keys[0];
    await page.getByRole("button", { name: "Réduire la galerie" }).click();
    await page.waitForTimeout(400);
    const start = await tileWidth(page, key);

    await dragHandle(page, key, -start * 0.6, -200);
    await expect.poll(() => tileWidth(page, key)).toBeLessThan(start * 0.6);
    await page.mouse.up();
    const shrunk = await tileWidth(page, key);
    await page.waitForTimeout(400);
    expect(await tileWidth(page, key)).toBe(shrunk);

    await page.getByRole("link", { name: "Annuler" }).click();
    await expect(page).toHaveURL(`${BASE}/`);
    await expect.poll(() => tileWidth(page, key)).toBeGreaterThan(shrunk);
    await context.close();
  });

  test("les flèches sur la poignée changent le format, sans boucler, et Échap annule un geste", async ({
    browser,
  }) => {
    const { context, page } = await open(browser, { viewport: { width: 1440, height: 1120 } });
    await page.goto("/?edition=1");
    const keys = await tileKeys(page);
    const key = keys.includes("revenue") ? "revenue" : keys[0];
    const label = () => handleOf(page, key).getAttribute("aria-label");

    await handleOf(page, key).focus();
    for (let press = 0; press < 5; press += 1) await page.keyboard.press("ArrowLeft");
    await expect.poll(label).toContain("format 1×1");
    await page.keyboard.press("ArrowRight");
    await expect.poll(label).toContain("format 2×1");
    await expect(handleOf(page, key)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(label).toContain("format 1×1");

    await dragHandle(page, key, 260, 0);
    await expect.poll(label).toContain("format 2×1");
    await page.keyboard.press("Escape");
    await expect.poll(label).toContain("format 1×1");
    await page.mouse.up();
    await expect.poll(label).toContain("format 1×1");
    await context.close();
  });

  test("Terminé enregistre le format choisi", async ({ browser }) => {
    const { context, page } = await open(browser, { viewport: { width: 1440, height: 1120 } });
    await page.goto("/?edition=1");
    const keys = await tileKeys(page);
    const key = keys.includes("revenue") ? "revenue" : keys[0];
    const original = await handleOf(page, key).getAttribute("aria-label");
    await handleOf(page, key).focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => handleOf(page, key).getAttribute("aria-label")).not.toBe(original);
    const changed = await handleOf(page, key).getAttribute("aria-label");
    await page.getByRole("button", { name: "Terminé" }).click();
    await expect(page).toHaveURL(`${BASE}/`);

    await page.goto("/?edition=1");
    expect(await handleOf(page, key).getAttribute("aria-label")).toBe(changed);
    await handleOf(page, key).focus();
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "Terminé" }).click();
    await expect(page).toHaveURL(`${BASE}/`);
    await context.close();
  });

  test("la galerie se réduit, le tableau reprend la largeur, et elle se rouvre au clavier", async ({
    browser,
  }) => {
    const { context, page } = await open(browser, { viewport: { width: 1440, height: 1120 } });
    await page.goto("/?edition=1");
    const grid = page.locator("[data-tile-key]").first().locator("xpath=..");
    await expect(grid).toBeVisible();
    const widthOpen = (await grid.boundingBox())?.width ?? 0;
    const gallery = page.getByRole("complementary", { name: "Galerie de tuiles" });

    const reduce = gallery.getByRole("button", { name: "Réduire la galerie" });
    await expect(reduce).toHaveAttribute("aria-expanded", "true");
    await reduce.focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("[data-gallery-item]")).toHaveCount(0);
    const reopen = gallery.getByRole("button", { name: "Rouvrir la galerie" });
    await expect(reopen).toBeFocused();
    await expect(reopen).toHaveAttribute("aria-expanded", "false");
    await expect(gallery.getByRole("button", { name: "Terminé" })).toBeVisible();
    await expect(gallery.getByRole("link", { name: "Annuler" })).toBeVisible();
    await expect
      .poll(async () => (await grid.boundingBox())?.width ?? 0)
      .toBeGreaterThan(widthOpen);

    await page.keyboard.press("Enter");
    await expect(page.locator("[data-gallery-item]").first()).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Réduire la galerie" })).toBeFocused();
    await context.close();
  });

  test("au doigt à 390 px : tirer la poignée change le format, sans défiler", async ({
    browser,
  }) => {
    const { context, page } = await open(browser, {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await page.goto("/?edition=1");
    const keys = await tileKeys(page);
    const key = keys.includes("revenue") ? "revenue" : keys[0];
    await handleOf(page, key).scrollIntoViewIfNeeded();
    const label = () => handleOf(page, key).getAttribute("aria-label");
    const start = await label();
    const box = await handleOf(page, key).boundingBox();
    if (!box) throw new Error("Poignée hors de l'écran");
    const scrollBefore = await page.evaluate(() => window.scrollY);

    const cdp = await context.newCDPSession(page);
    const touch = (type: string, x?: number, y?: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: x === undefined ? [] : [{ x, y }],
      } as never);
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await touch("touchStart", from.x, from.y);
    for (let step = 1; step <= 12; step += 1) {
      await touch("touchMove", from.x, from.y - (step * 240) / 12);
      await page.waitForTimeout(30);
    }
    await touch("touchEnd");

    await expect.poll(label).not.toBe(start);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });

  test("une adresse de reporting fantaisiste garde un écran entier", async ({ browser }) => {
    const { context, page } = await open(browser, { viewport: { width: 1440, height: 1120 } });
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    for (const query of [
      "?periode=abc&granularite=zz&activite=qq",
      "?mesure=abc",
      "?periode=a&periode=b",
    ]) {
      await page.goto(`/reporting${query}`);
      await expect(page.getByRole("tab", { selected: true })).toHaveCount(1);
      await expect(page.getByRole("tabpanel")).toBeVisible();
    }
    expect(problems).toEqual([]);
    await context.close();
  });
});

test.describe("en lecture seule", () => {
  test.skip(!viewer.email || !viewer.password, "E2E_VIEWER_EMAIL et E2E_VIEWER_PASSWORD requis");

  test("ni tuile financière, ni mesure financière, ni export", async ({ browser }) => {
    const state = await signIn(browser, viewer);
    const context = await browser.newContext({
      baseURL: BASE,
      storageState: state,
      viewport: { width: 1440, height: 1120 },
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("[data-tile-key]").first()).toBeVisible();
    const keys = await tileKeys(page);
    for (const key of ["revenue", "mrr", "collected", "shared_costs", "invoices", "treasury"]) {
      expect(keys).not.toContain(key);
    }

    // Un lien partagé par un associé vise une mesure que ce rôle n'a pas : l'écran reste plein.
    await page.goto("/reporting?mesure=marge");
    await expect(page.getByRole("tab", { selected: true })).toContainText("Conversion");
    await expect(page.getByRole("button", { name: "Exporter" })).toHaveCount(0);
    expect((await context.request.get("/api/reporting/export")).status()).toBe(403);
    await context.close();
  });
});

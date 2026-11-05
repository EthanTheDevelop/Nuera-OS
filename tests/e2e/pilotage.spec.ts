import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

/**
 * Tableau de bord et reporting : ce que seul un vrai navigateur peut révéler (focus du clavier, doigt,
 * réseau coupé). Aucune écriture : aucun scénario n'enregistre la disposition.
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

import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Parcours 1 et 6 (`docs/domain-model.md` §7) dans un vrai navigateur, sur la base de développement.
 * Le détail des règles est éprouvé par `tests/journeys/` ; ici, le chemin réel des écrans.
 *
 * Exige une base remplie (`npm run db:seed`) et E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD,
 * E2E_CLIENT_A_EMAIL, E2E_CLIENT_A_PASSWORD, E2E_CLIENT_B_EMAIL, E2E_CLIENT_B_PASSWORD.
 *
 * Écrit de vraies lignes, marquées « Parcours E2E » : projet, demande et fichier sont archivés à la fin.
 * Un devis accepté ne s'archive pas : il reste, sans projet actif. Aucun appel à Twenty : le devis
 * n'a pas d'affaire, et le client vient du seed.
 */
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };
const clientA = {
  email: process.env.E2E_CLIENT_A_EMAIL,
  password: process.env.E2E_CLIENT_A_PASSWORD,
};
const clientB = {
  email: process.env.E2E_CLIENT_B_EMAIL,
  password: process.env.E2E_CLIENT_B_PASSWORD,
};

/** Client du seed sans espace : le projet d'essai n'apparaît chez aucun client connecté. */
const QUOTE_CLIENT = "Cabinet Faure Avocats";

type Account = typeof admin;

/** better-auth limite les connexions à 3 par 10 s : on attend, plutôt que de lire un faux refus. */
async function signIn(page: Page, account: Account): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/login");
    await page.getByLabel(/e-mail/i).fill(account.email ?? "");
    await page.getByLabel(/mot de passe/i).fill(account.password ?? "");
    await page.getByRole("button", { name: /se connecter/i }).click();
    const limited = page.getByText(/trop de tentatives/i);
    const outcome = await Promise.race([
      page.waitForURL((url) => !url.pathname.startsWith("/login")).then(() => "in" as const),
      limited.waitFor().then(() => "limited" as const),
    ]);
    if (outcome === "in") return;
    await page.waitForTimeout(11_000);
  }
  throw new Error("Connexion impossible : limite de tentatives.");
}

async function open(browser: Browser, account: Account): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await signIn(page, account);
  return page;
}

test.describe.configure({ mode: "serial" });
test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "Parcours joués une fois, sur bureau");

test.describe("parcours 1 : du devis au projet", () => {
  test.skip(!admin.email || !admin.password, "E2E_ADMIN_EMAIL et E2E_ADMIN_PASSWORD requis");
  test.setTimeout(120_000);

  test("un devis accepté donne un projet, un seul", async ({ browser }) => {
    const page = await open(browser, admin);
    const title = `Parcours E2E ${Date.now()}`;

    await page.goto("/devis");
    await page.getByRole("button", { name: "+ Nouveau devis" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Client").selectOption({ label: QUOTE_CLIENT });
    await dialog.getByLabel(/^Offre/).fill(title);
    await dialog.getByRole("button", { name: "Créer le devis" }).click();
    await expect(page).toHaveURL(/\/devis\/[0-9a-f-]+\/modifier/);
    const quotePath = new URL(page.url()).pathname.replace("/modifier", "");

    await page.getByRole("button", { name: "Ligne libre" }).click();
    await page.getByLabel("Prestation").fill("Site vitrine");
    await page.getByLabel("Prix unitaire HT").fill("7800");
    await page.getByLabel("Périmètre").fill("5 pages");
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("Valable jusqu'au").fill(until);
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${quotePath}$`));

    // Sans DocuSeal ni signature en ligne : envoi manuel, puis acceptation enregistrée.
    await page.getByRole("button", { name: "Envoyer à signer" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Marquer comme envoyé" }).click();
    await expect(page.getByRole("button", { name: "Enregistrer l’acceptation" })).toBeVisible();

    await page.getByRole("button", { name: "Enregistrer l’acceptation" }).click();
    const accept = page.getByRole("dialog");
    await accept.getByLabel("Référence du document signé").fill(`E2E-${Date.now()}`);
    await accept.getByRole("button", { name: "Enregistrer l’acceptation" }).click();

    const projectLink = page.getByRole("link", { name: /P-\d{4}-\d+/ }).first();
    await expect(projectLink).toBeVisible();
    await expect(page.getByRole("button", { name: "Enregistrer l’acceptation" })).toHaveCount(0);

    // Le projet existe côté production, une seule fois, y compris après rechargement.
    await page.reload();
    await page.goto(`/projets?vue=a-venir&q=${encodeURIComponent(title)}`);
    await expect(page.getByText(title)).toHaveCount(1);
    await page.getByRole("link", { name: new RegExp(title) }).click();
    await expect(page).toHaveURL(/\/projets\/[0-9a-f-]+/);
    await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible();

    // Ménage : le projet d'essai s'archive.
    await page.getByRole("button", { name: "Changer le statut" }).click();
    await page.getByRole("menuitem", { name: "Archiver le projet" }).click();
    const confirm = page.getByRole("dialog");
    await confirm.getByRole("button", { name: "Archiver", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await page.goto(`/projets?vue=a-venir&q=${encodeURIComponent(title)}`);
    await expect(page.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
    await page.context().close();
  });
});

test.describe("parcours 6 : client connecté, agence, aucun accès croisé", () => {
  test.skip(
    !admin.email || !clientA.email || !clientA.password || !clientB.email || !clientB.password,
    "E2E_ADMIN_* , E2E_CLIENT_A_* et E2E_CLIENT_B_* requis",
  );
  test.setTimeout(120_000);

  test("une demande du client arrive à l'agence, et l'autre client ne la voit pas", async ({
    browser,
  }) => {
    const subject = `Parcours E2E ${Date.now()}`;

    // Le client A écrit depuis son espace.
    const a = await open(browser, clientA);
    await expect(a).toHaveURL(/\/espace/);
    await a.goto("/espace/demandes");
    await a
      .getByRole("button", { name: /nouvelle demande/i })
      .first()
      .click();
    const form = a.getByRole("dialog");
    await form.getByLabel("Votre demande, en une ligne").fill(subject);
    await form.getByLabel("Quelques détails").fill("Essai de bout en bout.");
    await form.getByRole("button", { name: "Envoyer ma demande" }).click();
    await expect(a).toHaveURL(/\/espace\/demandes\/[0-9a-f-]+/);
    await expect(a.getByRole("heading", { name: subject })).toBeVisible();
    const ticketId = new URL(a.url()).pathname.split("/").pop() ?? "";
    await a.goto("/espace/demandes");
    await expect(a.getByRole("link", { name: new RegExp(subject) })).toBeVisible();

    // Le client A dépose un fichier par la vraie route. Les fichiers du seed n'ont pas de contenu.
    const uploaded = await a.request.post(
      `/api/documents/upload?filename=${encodeURIComponent(`${subject}.pdf`)}`,
      {
        headers: { origin: BASE, "content-type": "application/pdf" },
        data: Buffer.from(`%PDF-1.7\n${subject}\n%%EOF\n`),
      },
    );
    expect(uploaded.status()).toBe(201);
    const documentId = ((await uploaded.json()) as { document: { id: string } }).document.id;
    const fileHref = `/api/documents/${documentId}/download`;
    expect((await a.request.get(fileHref)).status()).toBe(200);

    // L'agence la lit.
    const agency = await open(browser, admin);
    await agency.goto(`/support/${ticketId}`);
    await expect(agency.getByText(subject).first()).toBeVisible();
    await expect(agency.getByText("Essai de bout en bout.").first()).toBeVisible();
    expect((await agency.request.get(fileHref)).status()).toBe(200);

    // Le client B n'y a pas accès : ni la demande, ni le fichier, ni la liste.
    const b = await open(browser, clientB);
    await expect(b).toHaveURL(/\/espace/);
    const direct = await b.goto(`/espace/demandes/${ticketId}`);
    expect(direct?.status()).toBe(404);
    expect((await b.request.get(fileHref)).status()).toBe(404);
    await b.goto("/espace/demandes");
    await expect(b.getByText(subject)).toHaveCount(0);
    // Un client n'ouvre pas non plus l'écran interne.
    await b.goto(`/support/${ticketId}`);
    await expect(b).toHaveURL(/\/espace/);

    // Ménage : la demande d'essai s'archive.
    await agency.getByRole("button", { name: "Archiver", exact: true }).click();
    await agency
      .getByRole("dialog", { name: /archiver/i })
      .getByRole("button", { name: "Archiver" })
      .click();
    await expect(agency.getByRole("button", { name: "Archiver", exact: true })).toHaveCount(0);
    await agency.goto(`/documents/${documentId}`);
    await agency.getByRole("button", { name: "Archiver", exact: true }).click();
    const confirmFile = agency.getByRole("dialog", { name: /archiver/i });
    await confirmFile.getByRole("button", { name: "Archiver" }).click();
    await expect(confirmFile).toHaveCount(0);
    await expect.poll(async () => (await a.request.get(fileHref)).status()).toBe(404);

    await a.context().close();
    await b.context().close();
    await agency.context().close();
  });
});

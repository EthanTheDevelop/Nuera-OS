import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout. Si rien n'écoute sur le port, Playwright lance `npm run dev`.
 * Base locale : `docker compose up -d`, puis `npm run db:migrate`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Dossier déjà ignoré par git.
  outputDir: "./coverage/e2e",
  // En développement, la première compilation d'une route prend plusieurs secondes.
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "bureau",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1120 } },
    },
    {
      name: "telephone",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

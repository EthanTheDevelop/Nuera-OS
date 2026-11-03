import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit ne charge pas `.env` seul ; on s'aligne sur les scripts npm.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  // `generate` n'a pas besoin de connexion ; `studio` utilise DATABASE_URL.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});

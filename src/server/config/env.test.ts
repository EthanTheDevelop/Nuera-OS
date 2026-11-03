import { describe, expect, it } from "vitest";
import { InvalidEnvironmentError, parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("applique les valeurs par défaut", () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.DB_MIGRATE_ON_START).toBe(false);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("convertit les booléens textuels", () => {
    expect(parseEnv({ ...valid, DB_MIGRATE_ON_START: "true" }).DB_MIGRATE_ON_START).toBe(true);
  });

  it("refuse un secret trop court sans jamais en afficher la valeur", () => {
    const secret = "court-mais-secret";
    try {
      parseEnv({ ...valid, BETTER_AUTH_SECRET: secret });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEnvironmentError);
      expect((error as Error).message).toContain("BETTER_AUTH_SECRET");
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("refuse une URL de base de données non PostgreSQL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://localhost/db" })).toThrow(
      InvalidEnvironmentError,
    );
  });

  it("signale toutes les variables manquantes", () => {
    try {
      parseEnv({});
      expect.unreachable();
    } catch (error) {
      const { issues } = error as InvalidEnvironmentError;
      expect(issues.join("\n")).toMatch(
        /DATABASE_URL[\s\S]*BETTER_AUTH_SECRET[\s\S]*BETTER_AUTH_URL/,
      );
    }
  });
});

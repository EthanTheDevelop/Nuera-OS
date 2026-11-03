import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { REDACTED, redact, serializeError } from "./redact";

describe("redact", () => {
  it("masque les clés sensibles, y compris imbriquées", () => {
    const output = redact({
      userId: "u1",
      password: "hunter2",
      headers: { Authorization: "Bearer abc", cookie: "s=1" },
      nested: [{ apiKey: "k", label: "ok" }],
    });
    expect(output).toEqual({
      userId: "u1",
      password: REDACTED,
      headers: { Authorization: REDACTED, cookie: REDACTED },
      nested: [{ apiKey: REDACTED, label: "ok" }],
    });
  });

  it("borne la profondeur (structures cycliques ou très profondes)", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => redact(cyclic)).not.toThrow();
  });
});

describe("serializeError", () => {
  it("n'expose jamais les paramètres d'une requête Drizzle", () => {
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "users_email_unique",
      detail: "Key (email)=(alice@example.com) already exists.",
    });
    const error = new DrizzleQueryError(
      'insert into "users" ("email", "password") values ($1, $2)',
      ["alice@example.com", "$scrypt$secret-hash"],
      cause,
    );

    const serialized = JSON.stringify(serializeError(error));

    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("secret-hash");
    expect(serialized).toContain('insert into \\"users\\"');
    expect(serialized).toContain("23505");
    expect(serialized).toContain("users_email_unique");
  });

  it("gère une valeur levée qui n'est pas une Error", () => {
    expect(serializeError(42)).toEqual({ name: "NonError", message: "Valeur non-Error levée" });
  });
});

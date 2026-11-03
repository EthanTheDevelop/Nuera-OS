import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { formDataToObject, toActionErrorState } from "./actions";

describe("toActionErrorState", () => {
  it("expose le message et les erreurs par champ d'une erreur métier", () => {
    const state = toActionErrorState(new ValidationError("Invalide", { name: ["Obligatoire"] }), {
      action: "test",
    });
    expect(state).toEqual({
      status: "error",
      message: "Invalide",
      fieldErrors: { name: ["Obligatoire"] },
      values: undefined,
    });
  });

  it("n'expose aucun détail d'une erreur inattendue", () => {
    const state = toActionErrorState(new Error("connexion refusée à 10.0.0.12:5432"), {
      action: "test",
    });
    expect(state.status).toBe("error");
    expect(JSON.stringify(state)).not.toContain("10.0.0.12");
  });

  it("ne renvoie jamais un mot de passe au navigateur", () => {
    const state = toActionErrorState(new ConflictError("Conflit"), {
      action: "test",
      values: { email: "a@b.c", password: "secret-value" },
    });
    expect(state.status === "error" && state.values).toEqual({ email: "a@b.c" });
  });

  it("conserve le message des erreurs d'autorisation", () => {
    const state = toActionErrorState(new ForbiddenError(), { action: "test" });
    expect(state.status === "error" && state.message).toMatch(/droits/);
  });
});

describe("formDataToObject", () => {
  it("ne garde que les champs texte hors champs internes Next.js", () => {
    const formData = new FormData();
    formData.set("name", "Nuera");
    formData.set("$ACTION_ID_abc", "");
    formData.set("file", new Blob(["x"]));
    expect(formDataToObject(formData)).toEqual({ name: "Nuera" });
  });
});

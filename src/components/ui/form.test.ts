import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BuildScript } from "@/components/motion/build-script";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { SelectField } from "./form";

describe("SelectField", () => {
  it("accepte un value contrôlé avec state, sans erreur React", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      createElement(
        SelectField,
        {
          name: "kind",
          label: "Type",
          state: IDLE_ACTION_STATE,
          value: "b",
          onChange: () => {},
        },
        createElement("option", { value: "a" }, "A"),
        createElement("option", { value: "b" }, "B"),
      ),
    );
    expect(logged).not.toHaveBeenCalled();
    expect(html).toContain('value="b" selected');
    logged.mockRestore();
  });

  it("garde sa valeur par défaut hors contrôle", () => {
    const html = renderToString(
      createElement(
        SelectField,
        { name: "kind", label: "Type", state: IDLE_ACTION_STATE, defaultValue: "a" },
        createElement("option", { value: "a" }, "A"),
      ),
    );
    expect(html).toContain('value="a" selected');
  });
});

describe("BuildScript", () => {
  it("part dans le HTML du serveur, avec le nonce de la requête", () => {
    const html = renderToString(createElement(BuildScript, { nonce: "abc123" }));
    expect(html).toContain('<script nonce="abc123">');
    expect(html).toContain("data-theme");
  });
});

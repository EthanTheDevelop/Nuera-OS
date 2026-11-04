import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cn, TEXT_SIZE_TOKENS } from "./cn";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("cn", () => {
  it("garde une taille nommée à côté d'une couleur", () => {
    expect(cn("text-cell", "text-muted")).toBe("text-cell text-muted");
    expect(cn("font-mono text-table-head text-muted uppercase")).toContain("text-table-head");
  });

  it("résout les vrais conflits", () => {
    expect(cn("text-cell", "text-badge")).toBe("text-badge");
    expect(cn("text-muted", "text-accent")).toBe("text-accent");
    expect(cn("rounded-xl", "rounded-lg")).toBe("rounded-lg");
    expect(cn("shadow-soft", "shadow-float")).toBe("shadow-float");
  });

  it("connaît toutes les tailles nommées de la feuille de style", () => {
    const declared = [...css.matchAll(/^\s*--text-([a-z-]+):/gm)]
      .map((match) => match[1] ?? "")
      .filter((name) => !name.includes("--"));
    const tshirt = /^(\d?xl|lg|base|sm|xs|\*)$/;
    const named = declared.filter((name) => !tshirt.test(name));
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(TEXT_SIZE_TOKENS, name).toContain(name);
  });
});

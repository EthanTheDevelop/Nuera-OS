import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILD_MS, DURATION_MS, EASE, motionPreset, STAGGER_MS } from "./motion";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function cssVar(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!match?.[1]) throw new Error(`Variable CSS absente : --${name}`);
  return match[1].trim();
}

describe("jetons de mouvement", () => {
  it("les durées CSS et TypeScript sont identiques", () => {
    for (const [name, ms] of Object.entries(DURATION_MS)) {
      expect(cssVar(`dur-${name}`), name).toBe(`${ms}ms`);
    }
    for (const [name, ms] of Object.entries(STAGGER_MS)) {
      expect(cssVar(`stagger-${name}`), name).toBe(`${ms}ms`);
    }
    for (const [name, ms] of Object.entries(BUILD_MS)) {
      expect(cssVar(`build-${name}`), name).toBe(`${ms}ms`);
    }
  });

  it("les courbes CSS et TypeScript sont identiques", () => {
    const names = {
      out: "out",
      inOut: "in-out",
      emphasis: "emphasis",
      steady: "steady",
      exit: "exit",
    };
    for (const [key, cssName] of Object.entries(names)) {
      const points = EASE[key as keyof typeof EASE].join(", ");
      expect(cssVar(`ease-${cssName}`), key).toBe(`cubic-bezier(${points})`);
    }
  });

  it("respecte la réaction de 150 ms (arbitrage A8)", () => {
    expect(DURATION_MS.fast).toBe(150);
  });
});

describe("réduire les animations", () => {
  const reduced = motionPreset({ reduced: true });

  it("ne garde qu'un fondu de 150 ms, partout", () => {
    expect(reduced.enter.initial).toEqual({ opacity: 0 });
    expect(reduced.window.initial).toEqual({ opacity: 0 });
    expect(reduced.row.hidden).toEqual({ opacity: 0 });
    expect(reduced.swapOut.opacity).toBe(0);
    expect(reduced.enter.transition.duration).toBe(DURATION_MS.reduced / 1000);
    expect(reduced.window.animate.transition.duration).toBe(DURATION_MS.reduced / 1000);
  });

  it("n'a ni flou, ni translation, ni échelle, ni cascade", () => {
    const serialized = JSON.stringify(reduced);
    expect(serialized).not.toMatch(/blur|scale|"y"|"x"|staggerChildren/);
  });

  it("le CSS impose le même fondu à toutes les classes d'entrée", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const name of [
      "anim-frame",
      "anim-content",
      "anim-data",
      "anim-grow-x",
      "anim-grow-y",
      "anim-wipe",
    ]) {
      expect(block).toContain(`.${name}`);
    }
    expect(block).toContain("animation-name: nu-fade !important");
    expect(block).toContain("animation-duration: var(--dur-reduced) !important");
  });
});

describe("préréglage client", () => {
  it("n'a pas de flou d'arrivée (note C3)", () => {
    const client = motionPreset({ reduced: false, client: true });
    expect(client.enter.initial).toEqual({ opacity: 0 });
    expect(client.enter.transition.duration).toBe(DURATION_MS.client / 1000);
  });
});

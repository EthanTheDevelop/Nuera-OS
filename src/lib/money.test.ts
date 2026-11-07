import { describe, expect, it } from "vitest";
import {
  centsToEuros,
  eurosToCents,
  formatCents,
  formatCentsHT,
  formatCentsSigned,
  marginPercent,
  parseEurosToCents,
  percentOfCents,
  ratioPercent,
  sumCents,
} from "./money";

/** Intl utilise des espaces insécables : les tests comparent le texte visible. */
const visible = (value: string) => value.replace(/[  ]/g, " ");

describe("formatCents", () => {
  it("masque les centimes quand ils sont nuls", () => {
    expect(visible(formatCents(780000))).toBe("7 800 €");
    expect(visible(formatCents(0))).toBe("0 €");
  });

  it("affiche les centimes quand ils existent", () => {
    expect(visible(formatCents(123450))).toBe("1 234,50 €");
    expect(visible(formatCents(5))).toBe("0,05 €");
  });

  it("respecte le mode demandé", () => {
    expect(visible(formatCents(780000, { cents: "always" }))).toBe("7 800,00 €");
    expect(visible(formatCents(123456, { cents: "never" }))).toBe("1 235 €");
  });

  it("gère les valeurs négatives et absentes", () => {
    expect(visible(formatCents(-5000))).toBe("−50 €");
    expect(formatCents(null)).toBe("—");
    expect(formatCents(undefined)).toBe("—");
    expect(formatCents(Number.NaN)).toBe("—");
  });

  it("utilise une espace insécable que la police dessine, jamais l'espace fine", () => {
    expect(formatCents(780000)).toBe("7 800 €");
  });

  it("ajoute la mention HT", () => {
    expect(visible(formatCentsHT(780000))).toBe("7 800 € HT");
    expect(formatCentsHT(null)).toBe("—");
  });

  it("signe un écart", () => {
    expect(visible(formatCentsSigned(1200))).toBe("+12 €");
    expect(visible(formatCentsSigned(-1200))).toBe("−12 €");
    expect(visible(formatCentsSigned(0))).toBe("0 €");
    expect(formatCentsSigned(null)).toBe("—");
  });
});

describe("conversions", () => {
  it("convertit sans erreur d'arrondi", () => {
    expect(eurosToCents(19.99)).toBe(1999);
    expect(eurosToCents(1.005)).toBe(100);
    expect(centsToEuros(1999)).toBe(19.99);
  });

  it("lit une saisie française ou anglaise", () => {
    expect(parseEurosToCents("1 234,50")).toBe(123450);
    expect(parseEurosToCents("1 234,5 €")).toBe(123450);
    expect(parseEurosToCents("1234.5")).toBe(123450);
    expect(parseEurosToCents("-12")).toBe(-1200);
  });

  it("refuse ce qui n'est pas un montant", () => {
    expect(parseEurosToCents("")).toBeNull();
    expect(parseEurosToCents(null)).toBeNull();
    expect(parseEurosToCents("abc")).toBeNull();
    expect(parseEurosToCents("12,345")).toBeNull();
    expect(parseEurosToCents("1,2,3")).toBeNull();
  });
});

describe("calculs", () => {
  it("additionne en ignorant les absents", () => {
    expect(sumCents([100, null, 250, undefined])).toBe(350);
    expect(sumCents([])).toBe(0);
  });

  it("arrondit une part au centime", () => {
    expect(percentOfCents(975000, 30)).toBe(292500);
    expect(percentOfCents(999, 20)).toBe(200);
  });

  it("renvoie null quand le ratio n'est pas calculable", () => {
    expect(ratioPercent(50, 200)).toBe(25);
    expect(ratioPercent(50, 0)).toBeNull();
    expect(marginPercent(1000, 600)).toBe(40);
    expect(marginPercent(0, 600)).toBeNull();
    expect(marginPercent(1000, 1500)).toBe(-50);
  });
});

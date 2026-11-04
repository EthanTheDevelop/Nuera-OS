import { describe, expect, it } from "vitest";
import {
  addBillingPeriod,
  addDays,
  addMonths,
  categoryCovered,
  monthlyAmountCents,
  parisDay,
  periodWindow,
  quotaExceeded,
  quotaExhausted,
  quotaPercent,
  quotaReachedAlert,
  worstQuotaPercent,
} from "@/modules/contracts/contract.rules";

describe("dates du contrat", () => {
  it("garde le jour d'ancrage en fin de mois, sans dérive", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("ajoute une période de facturation", () => {
    expect(addBillingPeriod("2026-01-10", "monthly")).toBe("2026-02-10");
    expect(addBillingPeriod("2026-01-10", "quarterly")).toBe("2026-04-10");
    expect(addBillingPeriod("2026-01-10", "yearly")).toBe("2027-01-10");
  });

  it("franchit un changement d'année en jours", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("lit le jour à Paris, pas en UTC", () => {
    expect(parisDay(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
});

describe("période de quota", () => {
  it("suit l'anniversaire du début du contrat", () => {
    const contract = { startOn: "2026-03-15", period: "monthly" } as const;
    expect(periodWindow(contract, "2026-03-15")).toEqual({
      start: "2026-03-15",
      end: "2026-04-14",
    });
    expect(periodWindow(contract, "2026-04-14")).toEqual({
      start: "2026-03-15",
      end: "2026-04-14",
    });
    expect(periodWindow(contract, "2026-04-15")).toEqual({
      start: "2026-04-15",
      end: "2026-05-14",
    });
  });

  it("reste juste quand le jour d'ancrage n'existe pas dans le mois", () => {
    const contract = { startOn: "2026-01-31", period: "monthly" } as const;
    expect(periodWindow(contract, "2026-02-28")).toEqual({
      start: "2026-02-28",
      end: "2026-03-30",
    });
    expect(periodWindow(contract, "2026-03-31")).toEqual({
      start: "2026-03-31",
      end: "2026-04-29",
    });
  });

  it("compte par trimestre et par année", () => {
    expect(periodWindow({ startOn: "2026-02-01", period: "quarterly" }, "2026-06-20").start).toBe(
      "2026-05-01",
    );
    expect(periodWindow({ startOn: "2025-02-01", period: "yearly" }, "2026-06-20").start).toBe(
      "2026-02-01",
    );
  });

  it("donne la première période avant le début du contrat", () => {
    expect(periodWindow({ startOn: "2027-01-10", period: "monthly" }, "2026-11-04")).toEqual({
      start: "2027-01-10",
      end: "2027-02-09",
    });
  });

  it("prend la période civile sans date de début", () => {
    expect(periodWindow({ startOn: null, period: "monthly" }, "2026-11-04")).toEqual({
      start: "2026-11-01",
      end: "2026-11-30",
    });
    expect(periodWindow({ startOn: null, period: "quarterly" }, "2026-11-04")).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
    expect(periodWindow({ startOn: null, period: "yearly" }, "2026-11-04")).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
  });
});

describe("quotas", () => {
  const figures = (
    consumedMinutes: number,
    includedMinutes: number | null,
    consumedTickets = 0,
    includedTickets: number | null = null,
  ) => ({ consumedMinutes, includedMinutes, consumedTickets, includedTickets });

  it("ne calcule aucun pourcentage sans quota ou avec un quota nul", () => {
    expect(quotaPercent(10, null)).toBeNull();
    expect(quotaPercent(10, 0)).toBeNull();
    expect(quotaPercent(45, 60)).toBe(75);
  });

  it("retient le plus consommé des deux quotas", () => {
    expect(worstQuotaPercent(figures(30, 60, 3, 3))).toBe(100);
    expect(worstQuotaPercent(figures(0, null))).toBeNull();
  });

  it("alerte à 80 %, pas avant", () => {
    expect(quotaReachedAlert(figures(47, 60))).toBe(false);
    expect(quotaReachedAlert(figures(48, 60))).toBe(true);
  });

  it("distingue l'épuisement du dépassement", () => {
    expect(quotaExhausted(figures(60, 60))).toBe(true);
    expect(quotaExceeded(figures(60, 60))).toBe(false);
    expect(quotaExceeded(figures(61, 60))).toBe(true);
  });

  it("considère un quota de 0 comme épuisé et dépassé dès la première minute", () => {
    expect(quotaExhausted(figures(0, 0))).toBe(true);
    expect(quotaExceeded(figures(0, 0))).toBe(false);
    expect(quotaExceeded(figures(1, 0))).toBe(true);
    expect(quotaReachedAlert(figures(1, 0))).toBe(false);
  });

  it("ne limite rien sans quota", () => {
    expect(quotaExhausted(figures(9999, null))).toBe(false);
    expect(quotaExceeded(figures(9999, null))).toBe(false);
  });
});

describe("règles commerciales", () => {
  it("ramène un prix au mois sans arrondir", () => {
    expect(monthlyAmountCents(4900, "monthly")).toBe(4900);
    expect(monthlyAmountCents(30000, "quarterly")).toBe(10000);
    expect(monthlyAmountCents(49000, "yearly")).toBeCloseTo(4083.33, 2);
  });

  it("n'inclut une évolution dans aucun type de contrat", () => {
    for (const kind of ["hosting", "maintenance", "support", "accompaniment"] as const) {
      expect(categoryCovered(kind, "change")).toBe(false);
    }
  });

  it("couvre selon le type de contrat", () => {
    expect(categoryCovered("hosting", "incident")).toBe(true);
    expect(categoryCovered("hosting", "bug")).toBe(false);
    expect(categoryCovered("maintenance", "bug")).toBe(true);
    expect(categoryCovered("accompaniment", "incident")).toBe(false);
  });
});

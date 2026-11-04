import { describe, expect, it } from "vitest";
import {
  addDays,
  isoWeek,
  monthRange,
  parseWeekKey,
  weekKey,
  weekLabel,
  weekStart,
} from "./calendar";
import { parseCellDuration, parseChargeDuration } from "./time-format";

describe("saisies courtes", () => {
  it("lit une cellule en heures", () => {
    expect(parseCellDuration("3")).toBe(180);
    expect(parseCellDuration("2,5")).toBe(150);
    expect(parseCellDuration("1h30")).toBe(90);
    expect(parseCellDuration("45 min")).toBe(45);
    expect(parseCellDuration("0,5 j")).toBe(210);
    expect(parseCellDuration("")).toBe(0);
    expect(parseCellDuration("—")).toBe(0);
    expect(parseCellDuration("abc")).toBeNull();
  });

  it("lit une charge en journées", () => {
    expect(parseChargeDuration("15")).toBe(6300);
    expect(parseChargeDuration("15 j")).toBe(6300);
    expect(parseChargeDuration("35h")).toBe(2100);
    expect(parseChargeDuration("")).toBeNull();
    expect(parseChargeDuration("beaucoup")).toBeNull();
  });
});

describe("calendrier", () => {
  it("numérote les semaines selon ISO 8601, années à cheval comprises", () => {
    expect(isoWeek("2026-11-04")).toEqual({ year: 2026, week: 45 });
    expect(weekLabel("2026-11-04")).toBe("S45");
    expect(weekKey("2026-12-31")).toBe("2026-W53");
    expect(weekKey("2027-01-01")).toBe("2026-W53");
    expect(weekKey("2027-01-04")).toBe("2027-W01");
    expect(weekKey("2024-12-30")).toBe("2025-W01");
  });

  it("le lundi d'une semaine et sa clé se répondent", () => {
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(parseWeekKey("2026-W45")).toBe("2026-11-02");
    expect(parseWeekKey("2025-W01")).toBe("2024-12-30");
    expect(parseWeekKey("2026-W53")).toBe("2026-12-28");
    expect(parseWeekKey("2025-W53")).toBeNull();
    expect(parseWeekKey("n'importe quoi")).toBeNull();
    expect(parseWeekKey(null)).toBeNull();
  });

  it("calcule les bornes d'un mois et les décalages", () => {
    expect(monthRange("2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02-14")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

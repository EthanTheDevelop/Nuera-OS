import { describe, expect, it } from "vitest";
import {
  daysFromNow,
  formatDate,
  formatDateLong,
  formatDateNumeric,
  formatDateShort,
  formatDateTime,
  formatDays,
  formatMinutes,
  formatNumber,
  formatPercent,
  formatRelativeDate,
  formatRelativeTime,
  formatTime,
} from "./format";

const visible = (value: string) => value.replace(/[  ]/g, " ");

describe("durées", () => {
  it("formate des minutes", () => {
    expect(visible(formatMinutes(90))).toBe("1 h 30");
    expect(visible(formatMinutes(65))).toBe("1 h 05");
    expect(visible(formatMinutes(60))).toBe("1 h");
    expect(visible(formatMinutes(45))).toBe("45 min");
    expect(visible(formatMinutes(0))).toBe("0 min");
    expect(visible(formatMinutes(-90))).toBe("−1 h 30");
    expect(formatMinutes(null)).toBe("—");
  });

  it("formate des journées", () => {
    expect(visible(formatDays(420))).toBe("1 j");
    expect(visible(formatDays(630))).toBe("1,5 j");
    expect(visible(formatDays(480, 480))).toBe("1 j");
    expect(formatDays(undefined)).toBe("—");
  });
});

describe("dates", () => {
  it("garde le jour d'une date métier, sans décalage de fuseau", () => {
    expect(formatDate("2026-11-18")).toBe("18 novembre 2026");
    expect(formatDate("2026-01-01")).toBe("1 janvier 2026");
    expect(formatDateShort("2026-11-18")).toBe("18 nov.");
    expect(formatDateShort("2026-11-01")).toBe("1er nov.");
    expect(formatDateShort("2026-11-11")).toBe("11 nov.");
    expect(formatDateNumeric("2026-11-18")).toBe("18/11/2026");
    expect(formatDateLong("2026-11-03")).toBe("mardi 3 novembre 2026");
  });

  it("formate un instant à l'heure de Paris", () => {
    // 23:30 UTC est déjà le lendemain à Paris en hiver.
    expect(formatDate(new Date("2026-11-18T23:30:00Z"))).toBe("19 novembre 2026");
    expect(formatTime(new Date("2026-11-18T13:05:00Z"))).toBe("14:05");
    expect(formatTime("2026-07-01T13:05:00Z")).toBe("15:05");
    expect(visible(formatDateTime("2026-11-18T13:05:00Z"))).toBe("18 nov. 2026, 14:05");
  });

  it("affiche un tiret pour une valeur absente ou invalide", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("n'importe quoi")).toBe("—");
    expect(formatDateTime(new Date("invalid"))).toBe("—");
  });
});

describe("dates relatives", () => {
  const now = new Date("2026-11-03T10:00:00Z");

  it("compte en jours du calendrier", () => {
    expect(daysFromNow("2026-11-18", now)).toBe(15);
    expect(daysFromNow("2026-11-03", now)).toBe(0);
    expect(daysFromNow("2026-11-02", now)).toBe(-1);
    expect(daysFromNow(null, now)).toBeNull();
  });

  it("change de jour à minuit, heure de Paris", () => {
    const lateEvening = new Date("2026-11-03T22:30:00Z"); // 23:30 à Paris
    const pastMidnight = new Date("2026-11-03T23:30:00Z"); // 00:30 le 4 à Paris
    expect(daysFromNow("2026-11-04", lateEvening)).toBe(1);
    expect(daysFromNow("2026-11-04", pastMidnight)).toBe(0);
  });

  it("formate à la journée", () => {
    expect(formatRelativeDate("2026-11-03", now)).toBe("aujourd’hui");
    expect(formatRelativeDate("2026-11-02", now)).toBe("hier");
    expect(formatRelativeDate("2026-11-04", now)).toBe("demain");
    expect(visible(formatRelativeDate("2026-11-18", now))).toBe("dans 15 jours");
    expect(visible(formatRelativeDate("2026-10-31", now))).toBe("il y a 3 jours");
    expect(visible(formatRelativeDate("2026-08-01", now))).toBe("il y a 3 mois");
    expect(visible(formatRelativeDate("2024-11-03", now))).toBe("il y a 2 ans");
    expect(formatRelativeDate(null, now)).toBe("—");
  });

  it("formate à la minute pour un instant récent", () => {
    expect(formatRelativeTime(new Date("2026-11-03T09:59:30Z"), now)).toBe("à l'instant");
    expect(visible(formatRelativeTime(new Date("2026-11-03T09:55:00Z"), now))).toBe("il y a 5 min");
    expect(visible(formatRelativeTime(new Date("2026-11-03T08:00:00Z"), now))).toBe("il y a 2 h");
    expect(visible(formatRelativeTime(new Date("2026-11-03T10:30:00Z"), now))).toBe("dans 30 min");
    expect(visible(formatRelativeTime(new Date("2026-10-31T08:00:00Z"), now))).toBe(
      "il y a 3 jours",
    );
    expect(formatRelativeTime(null, now)).toBe("—");
  });
});

describe("nombres", () => {
  it("formate nombres et pourcentages", () => {
    expect(visible(formatNumber(1234567))).toBe("1 234 567");
    expect(visible(formatNumber(1.25, 1))).toBe("1,3");
    expect(visible(formatPercent(78))).toBe("78 %");
    expect(visible(formatPercent(12.34, 1))).toBe("12,3 %");
    expect(formatPercent(null)).toBe("—");
    expect(formatNumber(undefined)).toBe("—");
  });
});

import { describe, expect, it } from "vitest";
import { parseDurationToMinutes } from "./form-parsers";

describe("parseDurationToMinutes", () => {
  it.each([
    ["90", 90],
    ["90 min", 90],
    ["1h30", 90],
    ["1 h 30", 90],
    ["2h", 120],
    ["1,5 h", 90],
    ["0,5 j", 210],
    ["1j", 420],
  ])("%s → %i minutes", (input, minutes) => {
    expect(parseDurationToMinutes(input)).toBe(minutes);
  });

  it.each(["", "abc", "1h75", "h"])("refuse %j", (input) => {
    expect(parseDurationToMinutes(input)).toBeNull();
  });
});

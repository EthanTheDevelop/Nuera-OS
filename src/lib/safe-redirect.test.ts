import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it.each(["/", "/admin", "/a/b?c=1#d"])("accepte le chemin interne %s", (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/\tevil",
    "",
    "/login",
    "/login?next=/x",
  ])("refuse %j", (value) => {
    expect(safeRedirectPath(value)).toBe("/");
  });

  it("refuse les valeurs non textuelles", () => {
    expect(safeRedirectPath(["/a"])).toBe("/");
    expect(safeRedirectPath(undefined, "/fallback")).toBe("/fallback");
  });
});

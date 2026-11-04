import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  pageOffset,
  paginate,
  paginated,
  parsePagination,
  prefixTsQuery,
  totalPages,
} from "./pagination";

describe("parsePagination", () => {
  it("applique les valeurs par défaut", () => {
    expect(parsePagination(undefined)).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(parsePagination({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it("lit URLSearchParams et les chaînes de searchParams", () => {
    expect(parsePagination(new URLSearchParams("page=3&pageSize=50"))).toEqual({
      page: 3,
      pageSize: 50,
    });
    expect(parsePagination({ page: "2", pageSize: ["10", "20"] })).toEqual({
      page: 2,
      pageSize: 10,
    });
  });

  it("ignore une valeur invalide et plafonne la taille", () => {
    expect(parsePagination({ page: "-1", pageSize: "abc" })).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(parsePagination({ page: "1.5", pageSize: 0 })).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(parsePagination({ pageSize: "100000" }).pageSize).toBe(MAX_PAGE_SIZE);
  });
});

describe("page", () => {
  it("calcule le décalage et le nombre de pages", () => {
    expect(pageOffset({ page: 1, pageSize: 25 })).toBe(0);
    expect(pageOffset({ page: 3, pageSize: 25 })).toBe(50);
    expect(totalPages({ total: 0, pageSize: 25 })).toBe(1);
    expect(totalPages({ total: 25, pageSize: 25 })).toBe(1);
    expect(totalPages({ total: 26, pageSize: 25 })).toBe(2);
  });

  it("renvoie la forme du contrat", () => {
    expect(paginated(["a"], 40, { page: 2, pageSize: 1 })).toEqual({
      items: ["a"],
      total: 40,
      page: 2,
      pageSize: 1,
    });
  });

  it("passe limite et décalage au dépôt", async () => {
    const items = vi.fn(async () => ["x"]);
    const result = await paginate({ page: 2, pageSize: 10 }, { items, count: async () => 11 });
    expect(items).toHaveBeenCalledWith(10, 10);
    expect(result).toEqual({ items: ["x"], total: 11, page: 2, pageSize: 10 });
  });
});

describe("prefixTsQuery", () => {
  it("construit une requête par préfixes", () => {
    expect(prefixTsQuery("Atelier Lu")).toBe("atelier:* & lu:*");
    expect(prefixTsQuery("kine-rive.fr")).toBe("kine:* & rive:* & fr:*");
  });

  it("neutralise les opérateurs tsquery", () => {
    expect(prefixTsQuery("a' & !b | (c):*")).toBe("a:* & b:* & c:*");
  });

  it("renvoie null sans terme utile", () => {
    expect(prefixTsQuery("  ")).toBeNull();
    expect(prefixTsQuery("&|!")).toBeNull();
    expect(prefixTsQuery(undefined)).toBeNull();
  });
});

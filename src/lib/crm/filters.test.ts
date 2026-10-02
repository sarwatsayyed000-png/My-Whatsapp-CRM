import { describe, expect, it } from "vitest";

import { compareValues, filterDeals, matchesSearch, paginate } from "./filters";

const deals = [
  { title: "Golden visa", assigned_to: "p1", contact: { name: "Ali Khan", phone: "+971501234567" } },
  { title: "Family visa", assigned_to: null, contact: { name: "Sara", phone: "+447700900123" } },
  { title: "Study UK", assigned_to: "p2", contact: null },
];

describe("filterDeals", () => {
  it("filters by agent, unassigned and all", () => {
    expect(filterDeals(deals, "all", "")).toHaveLength(3);
    expect(filterDeals(deals, "unassigned", "").map((d) => d.title)).toEqual(["Family visa"]);
    expect(filterDeals(deals, "p2", "").map((d) => d.title)).toEqual(["Study UK"]);
  });

  it("searches title, contact name and phone", () => {
    expect(filterDeals(deals, "all", "golden").map((d) => d.title)).toEqual(["Golden visa"]);
    expect(filterDeals(deals, "all", "sara").map((d) => d.title)).toEqual(["Family visa"]);
    expect(filterDeals(deals, "all", "+971 50 123").map((d) => d.title)).toEqual(["Golden visa"]);
    expect(filterDeals(deals, "p1", "sara")).toEqual([]);
  });

  it("does not digit-match ordinary words", () => {
    expect(matchesSearch("visa 2", ["123"])).toBe(false);
  });
});

describe("compareValues / paginate", () => {
  it("sorts numbers and strings, blanks last", () => {
    expect([3, null, 1].sort((a, b) => compareValues(a, b, "asc"))).toEqual([1, 3, null]);
    expect(["b", "a", ""].sort((a, b) => compareValues(a, b, "desc"))).toEqual(["b", "a", ""]);
  });

  it("clamps pages", () => {
    const rows = Array.from({ length: 23 }, (_, i) => i);
    expect(paginate(rows, 3, 10)).toEqual({ rows: [20, 21, 22], page: 3, pageCount: 3 });
    expect(paginate(rows, 9, 10).page).toBe(3);
    expect(paginate([], 1, 10)).toEqual({ rows: [], page: 1, pageCount: 1 });
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addMonths, evaluateCondition, MissingValueError, nextFixed, overlappingVersions, previousWorkingDay, validateRuleFile, type Rule } from "../src/index.ts";

describe("addMonths", () => {
  it.each([
    ["2026-06-30", 9, "2027-03-31"],
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-02-28", 1, "2026-03-31"],
    ["2026-03-15", -2, "2026-01-15"],
    ["2026-12-10", 2, "2027-02-10"],
  ])("%s + %i months = %s", (d, n, want) => expect(addMonths(d, n)).toBe(want));
});

describe("conditions", () => {
  const ctx = { fact: { legalForm: "ltd", activities: ["takesCards"] }, series: {}, derived: { companySize: "small", n: 5 } };
  it("supports nesting, not, has, in, lte and sizeAtLeast", () => {
    expect(
      evaluateCondition(
        {
          all: [
            { any: [{ field: "fact.legalForm", op: "in", value: ["ltd", "plc"] }, { field: "derived.n", op: "gt", value: 99 }] },
            { not: { field: "fact.activities", op: "has", value: "importsGoods" } },
            { field: "derived.n", op: "lte", value: 5 },
            { field: "derived.companySize", op: "sizeAtLeast", value: "micro" },
          ],
        },
        ctx,
      ),
    ).toBe(true);
  });
  it("throws MissingValueError for unknown facts rather than guessing", () => {
    expect(() => evaluateCondition({ field: "fact.vatRegistered", op: "eq", value: false }, ctx)).toThrow(MissingValueError);
  });
});

describe("dates", () => {
  it("nextFixed finds the next 31 January after a tax year end", () => {
    expect(nextFixed("01-31", "2026-04-05")).toBe("2027-01-31");
  });
  it("previousWorkingDay skips weekends and bank holidays", () => {
    // 25 Dec 2026 is a Friday, 26 Dec a Saturday; 28 Dec is the substitute Boxing Day.
    expect(previousWorkingDay("2026-12-28", new Set(["2026-12-25", "2026-12-28"]))).toBe("2026-12-24");
  });
});

describe("publish checks", () => {
  it("flags overlapping inForce versions", () => {
    const r = (version: number, from: string, to: string | null) => ({ id: "x", version, status: "inForce", effectiveFrom: from, effectiveTo: to }) as Rule;
    expect(overlappingVersions([r(1, "2026-01-01", null), r(2, "2027-01-01", null)])).toEqual(["x: v1 overlaps v2"]);
    expect(overlappingVersions([r(1, "2026-01-01", "2027-01-01"), r(2, "2027-01-01", null)])).toEqual([]);
  });

  it("the shipped rule file passes schema validation", () => {
    const data = JSON.parse(readFileSync(new URL("../rules/growth-rules.json", import.meta.url), "utf8"));
    const report = validateRuleFile(data);
    expect(report.schemaErrors).toEqual([]);
    expect(report.overlaps).toEqual([]);
  });
});

// The 16 acceptance tests from the rule engine build specification. Expected
// results are Research's; the tax adviser confirms them before go-live.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addDays,
  apprenticeshipLevy,
  average12Months,
  averageHeadcountFY,
  companySizes,
  computeDeadline,
  evaluateEntity,
  evaluateEvent,
  evaluateRule,
  NOT_APPLYING,
  parameterAt,
  turnoverAdjusted,
  vatBackwardTest,
  vatForwardTest,
  type FinancialYearFigures,
  type ParameterFile,
  type Rule,
  type RuleState,
} from "../src/index.ts";

const params = JSON.parse(readFileSync(new URL("../rules/parameters.json", import.meta.url), "utf8")) as ParameterFile;
const sizeLimits = parameterAt(params, "companySize", "2026-04-06");
const vat = parameterAt(params, "vat", "2026-06-01");

const gbp = (pounds: number) => Math.round(pounds * 100);
const fy = (start: string, end: string, turnover: number, balance: number, staff: number, months = 12): FinancialYearFigures => ({
  start,
  end,
  lengthInMonths: months,
  turnoverPence: gbp(turnover),
  balanceSheetPence: gbp(balance),
  headcountMonths: Array(months).fill(staff),
});

function rule(partial: Partial<Rule> & Pick<Rule, "id">): Rule {
  return {
    version: 1,
    pack: "gb-core",
    factor: "test",
    title: partial.id,
    module: "Tax and HMRC",
    phase: 1,
    status: "inForce",
    mode: "signoff",
    trigger: "threshold",
    when: "always",
    obligations: [],
    onExit: [],
    effectiveFrom: "2024-04-01",
    effectiveTo: null,
    verified: true,
    ...partial,
  };
}

describe("1-2. company size two-year rule", () => {
  it("1: small, small, medium; a first miss alone does not change size", () => {
    const years = [
      fy("2025-04-01", "2026-03-31", 12e6, 6e6, 45),
      fy("2026-04-01", "2027-03-31", 17e6, 8e6, 45),
      fy("2027-04-01", "2028-03-31", 18e6, 8.5e6, 48),
    ];
    expect(companySizes(years, sizeLimits)).toEqual(["small", "small", "medium"]);
  });

  it("2: falling back in year three keeps the company small throughout", () => {
    const years = [
      fy("2025-04-01", "2026-03-31", 12e6, 6e6, 45),
      fy("2026-04-01", "2027-03-31", 17e6, 8e6, 45),
      fy("2027-04-01", "2028-03-31", 14e6, 7e6, 45),
    ];
    expect(companySizes(years, sizeLimits)).toEqual(["small", "small", "small"]);
  });
});

describe("3-5. VAT registration", () => {
  // 12 months to April 2026 total £89,000; to May 2026, £90,500.
  const series: Record<string, number> = { "2025-05": gbp(7_600), "2026-05": gbp(9_100) };
  for (const m of ["2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"]) {
    series[m] = gbp(7_400);
  }

  it("3: backward test passed at 31 May: register by 30 June, effective 1 July", () => {
    const s = series;
    expect(vatBackwardTest({ vatRegistered: false, taxableTurnoverByMonth: s, month: "2026-04", thresholds: vat }).kind).toBe("none");
    expect(vatBackwardTest({ vatRegistered: false, taxableTurnoverByMonth: s, month: "2026-05", thresholds: vat })).toEqual({
      kind: "register",
      test: "backward",
      triggerDate: "2026-05-31",
      deadline: "2026-06-30",
      effectiveDate: "2026-07-01",
    });
  });

  it("4: expected next 12 months at £85,000 means ask HMRC for an exception instead", () => {
    const outcome = vatBackwardTest({
      vatRegistered: false,
      taxableTurnoverByMonth: series,
      month: "2026-05",
      expectedTaxableTurnoverNext12Months: gbp(85_000),
      thresholds: vat,
    });
    expect(outcome.kind).toBe("askForException");
  });

  it("5: forward test on 10 March: register by 8 April, effective 10 March", () => {
    expect(
      vatForwardTest({ vatRegistered: false, day: "2026-03-10", expectedTaxableTurnoverNext30Days: gbp(95_000), thresholds: vat }),
    ).toEqual({ kind: "register", test: "forward", triggerDate: "2026-03-10", deadline: "2026-04-08", effectiveDate: "2026-03-10" });
  });
});

describe("6. headcount bases", () => {
  it("company size uses the FY average (48); a presentNow rule sees today's 52", () => {
    const year = fy("2025-04-01", "2026-03-31", 1e6, 1e6, 0);
    year.headcountMonths = [44, 46, 47, 48, 48, 48, 48, 49, 49, 50, 49, 50];
    expect(averageHeadcountFY(year)).toBe(48);

    const presentNowRule = rule({ id: "present", when: { field: "derived.headcount", op: "gte", value: 50 }, headcountBasis: "presentNow" });
    const sizeRule = rule({ id: "avg", when: { field: "derived.headcount", op: "gte", value: 50 }, headcountBasis: "averageFY" });
    const derivedForRule = (r: Rule) => ({ headcount: r.headcountBasis === "presentNow" ? 52 : averageHeadcountFY(year) });
    const input = { asOf: "2026-04-01", ctx: { fact: {}, series: {}, derived: {} }, anchors: {}, previous: {}, derivedForRule };
    expect(evaluateRule(presentNowRule, input).result).toBe(true);
    expect(evaluateRule(sizeRule, input).result).toBe(false);
  });
});

describe("7. pension duties", () => {
  it("first employee on 1 February 2026: declaration of compliance due 1 July 2026", () => {
    const pension = rule({
      id: "pension-auto-enrolment",
      trigger: "event",
      when: undefined,
      event: { type: "employeeStarting" },
      obligations: [
        {
          id: "declaration-of-compliance",
          title: "Declaration of compliance",
          recurrence: { every: "once" },
          deadline: { anchor: "triggerDate", payloadField: "payload.startDate", offset: { months: 5 } },
        },
      ],
    });
    const tasks = evaluateEvent(
      [pension],
      { eventId: "e1", type: "employeeStarting", occurredOn: "2026-01-20", sourceRef: "payroll:emp-1", confirmed: true, payload: { startDate: "2026-02-01" } },
      "2026-01-20",
      { fact: {}, series: {}, derived: {} },
    );
    expect(tasks.map((t) => t.deadline)).toEqual(["2026-07-01"]);
  });
});

describe("8. company deadlines", () => {
  it("year end 30 June 2026: accounts 31 March 2027, CT paid 1 April 2027, CT600 30 June 2027", () => {
    const anchors = { financialYearEnd: "2026-06-30", periodEnd: "2026-06-30" };
    expect(computeDeadline({ anchor: "financialYearEnd", offset: { months: 9 } }, anchors)).toBe("2027-03-31");
    expect(computeDeadline({ anchor: "periodEnd", offset: { months: 9, days: 1 } }, anchors)).toBe("2027-04-01");
    expect(computeDeadline({ anchor: "periodEnd", offset: { months: 12 } }, anchors)).toBe("2027-06-30");
  });
});

describe("9. announced rules give notices, never tasks", () => {
  it("sole trader with £25,000: no MTD task, an announced notice for April 2028", () => {
    const rules = JSON.parse(readFileSync(new URL("../rules/growth-rules.json", import.meta.url), "utf8")).rules as Rule[];
    const mtd = rules.filter((r) => r.id.startsWith("mtd-itsa"));
    const result = evaluateEntity({
      rules: mtd,
      asOf: "2026-11-01",
      ctx: { fact: { legalForm: "soleTrader" }, series: {}, derived: { mtdQualifyingIncome: gbp(25_000) } },
      anchors: {},
      previous: {},
    });
    expect(result.evaluations.flatMap((e) => e.tasks)).toEqual([]);
    expect(result.notices.map((n) => [n.ruleId, n.title.includes("announced")])).toContainEqual(["mtd-itsa-2028", true]);
    expect(result.notices.every((n) => n.kind === "notice")).toBe(true);
  });
});

describe("10. rule versions by date", () => {
  it("£92,000 at 31 March 2027 creates an obligation under v1; none at 30 April 2027 under v2", () => {
    const base = { id: "vat-registration", obligations: [{ id: "register", title: "Register for VAT", recurrence: { every: "once" as const }, deadline: { anchor: "triggerDate" as const, offset: { days: 30 } } }] };
    const rules = [
      rule({ ...base, version: 1, effectiveTo: "2027-04-01", when: { field: "series.taxableTurnoverRolling12", op: "gt", value: gbp(90_000) } }),
      rule({ ...base, version: 2, effectiveFrom: "2027-04-01", when: { field: "series.taxableTurnoverRolling12", op: "gt", value: gbp(95_000) } }),
    ];
    const ctx = { fact: {}, series: { taxableTurnoverRolling12: gbp(92_000) }, derived: {} };
    const march = evaluateEntity({ rules, asOf: "2027-03-31", ctx, anchors: {}, previous: {} });
    const april = evaluateEntity({ rules, asOf: "2027-04-30", ctx, anchors: {}, previous: {} });
    expect(march.evaluations[0]).toMatchObject({ ruleVersion: 1, transition: "entered" });
    expect(march.evaluations[0]?.tasks).toHaveLength(1);
    expect(april.evaluations[0]).toMatchObject({ ruleVersion: 2, result: false });
    expect(april.evaluations[0]?.tasks).toHaveLength(0);
  });
});

describe("11. group size", () => {
  it("micro parent in a group of £20m, £9m, 60 staff for two years: parent and group are medium", () => {
    const parentOwn = [fy("2025-01-01", "2025-12-31", 0.5e6, 0.3e6, 3), fy("2026-01-01", "2026-12-31", 0.5e6, 0.3e6, 3)];
    const groupNet = [fy("2025-01-01", "2025-12-31", 20e6, 9e6, 60), fy("2026-01-01", "2026-12-31", 20e6, 9e6, 60)];
    expect(companySizes(parentOwn, sizeLimits).at(-1)).toBe("micro");
    const groupSize = companySizes(groupNet, { small: sizeLimits.small, medium: sizeLimits.medium }).at(-1);
    expect(groupSize).toBe("medium");

    const audit = rule({ id: "audit", when: { field: "derived.companySize", op: "sizeAtLeast", value: "medium" }, sizeBasis: "group" });
    const derivedForRule = (r: Rule) => ({ companySize: r.sizeBasis === "group" ? groupSize : "micro" });
    expect(evaluateRule(audit, { asOf: "2027-01-01", ctx: { fact: {}, series: {}, derived: {} }, anchors: {}, previous: {}, derivedForRule }).result).toBe(true);
  });
});

describe("12. apprenticeship levy across connected companies", () => {
  it("£1.8m and £1.5m: both liable, one £15,000 allowance shared", () => {
    const levy = apprenticeshipLevy({ a: gbp(1.8e6), b: gbp(1.5e6) }, parameterAt(params, "apprenticeshipLevy", "2026-04-06"));
    expect(levy.liable.sort()).toEqual(["a", "b"]);
    expect(levy.sharedAllowancePence).toBe(gbp(15_000));
  });
});

describe("13. collective redundancy event", () => {
  it("25 proposed, first dismissal 1 June 2026: consultation and HR1 by 2 May 2026", () => {
    const r = rule({
      id: "collective-redundancy-20",
      trigger: "event",
      when: undefined,
      event: {
        type: "redundancyProposed",
        where: { all: [{ field: "payload.count90DaysAtEstablishment", op: "gte", value: 20 }, { field: "payload.count90DaysAtEstablishment", op: "lt", value: 100 }] },
      },
      obligations: [
        { id: "consult-and-hr1", title: "Start consultation and file HR1", recurrence: { every: "once" }, deadline: { anchor: "triggerDate", payloadField: "payload.firstDismissalDate", offset: { days: -30 } } },
      ],
    });
    const tasks = evaluateEvent(
      [r],
      { eventId: "e2", type: "redundancyProposed", occurredOn: "2026-04-01", sourceRef: "app:r-1", confirmed: true, payload: { count90DaysAtEstablishment: 25, firstDismissalDate: "2026-06-01" } },
      "2026-04-01",
      { fact: {}, series: {}, derived: {} },
    );
    expect(tasks.map((t) => t.deadline)).toEqual(["2026-05-02"]);

    const unconfirmed = evaluateEvent(
      [r],
      { eventId: "e3", type: "redundancyProposed", occurredOn: "2026-04-01", sourceRef: "email:x", confirmed: false, payload: { count90DaysAtEstablishment: 25, firstDismissalDate: "2026-06-01" } },
      "2026-04-01",
      { fact: {}, series: {}, derived: {} },
    );
    expect(unconfirmed).toEqual([]);
  });
});

describe("14. hysteresis", () => {
  it("enters at 50, holds through 49 and 51, exits after the third month at 48", () => {
    const r = rule({ id: "information-consultation", when: { field: "derived.headcount", op: "gte", value: 50 }, exitAfter: 3, headcountBasis: "average12Months" });
    let state: RuleState = NOT_APPLYING;
    const transitions = [50, 49, 51, 48, 48, 48].map((h, i) => {
      const asOf = `2026-0${i + 1}-28`;
      const ev = evaluateRule(r, { asOf, ctx: { fact: {}, series: {}, derived: { headcount: h } }, anchors: {}, previous: { [r.id]: state } });
      state = ev.state;
      return ev.transition;
    });
    expect(transitions).toEqual(["entered", "unchanged", "unchanged", "unchanged", "unchanged", "exited"]);
  });

  it("average12Months is the mean of the last 12 month-end counts", () => {
    const s: Record<string, number> = {};
    for (let m = 1; m <= 12; m++) s[`2026-${String(m).padStart(2, "0")}`] = m <= 6 ? 48 : 52;
    expect(average12Months(s, "2026-12")).toBe(50);
    expect(average12Months(s, "2027-01")).toBeUndefined();
  });
});

describe("15. unverified rules stay internal", () => {
  it("creates one internal expert-review task and nothing client-facing", () => {
    const r = rule({
      id: "unverified",
      verified: false,
      obligations: [{ id: "x", title: "Do X", recurrence: { every: "once" }, deadline: { anchor: "triggerDate", offset: { days: 30 } } }],
    });
    const ev = evaluateRule(r, { asOf: "2026-11-01", ctx: { fact: {}, series: {}, derived: {} }, anchors: {}, previous: {} });
    expect(ev.transition).toBe("entered");
    expect(ev.tasks).toHaveLength(1);
    expect(ev.tasks[0]).toMatchObject({ kind: "expertReview", audience: "internal" });
  });
});

describe("16. year-end change", () => {
  it("a 9-month year pro-rates turnover by 12/9 and moves the annual deadlines", () => {
    const short = fy("2026-04-01", "2026-12-31", 9e6, 1e6, 10, 9);
    expect(turnoverAdjusted(short)).toBe(gbp(12e6));
    const before = computeDeadline({ anchor: "financialYearEnd", offset: { months: 9 } }, { financialYearEnd: "2027-03-31" });
    const after = computeDeadline({ anchor: "financialYearEnd", offset: { months: 9 } }, { financialYearEnd: "2026-12-31" });
    expect([before, after]).toEqual(["2027-12-31", "2027-09-30"]);
  });
});

it("helper sanity: addDays crosses month ends", () => {
  expect(addDays("2026-05-31", 30)).toBe("2026-06-30");
});

import { describe, expect, it } from "vitest";
import { MockCompaniesHouse, MockHmrc } from "@geartrain/connectors";
import { addMonths, loadParameters, loadRuleFile } from "@geartrain/rules-engine";
import { copperleaf, fenwick, generateClient, northgate, type ClientDataset } from "@geartrain/synthetic";
import { buildCalendar, entityContext, evaluationDates, runEngine, type Calendar } from "../src/index.ts";

const ASOF = "2026-11-03";
const ONBOARDED = "2026-10-01";
const rules = loadRuleFile().rules;
const params = loadParameters();
const data = { fenwick: generateClient(fenwick), copperleaf: generateClient(copperleaf), northgate: generateClient(northgate) };
const ch = new MockCompaniesHouse(Object.values(data), ASOF);
const calendar = (d: ClientDataset): Promise<Calendar> =>
  buildCalendar(d, { rules, params, onboardedOn: ONBOARDED, asOf: ASOF, hmrc: new MockHmrc(d, ASOF), companiesHouse: ch });

describe("engine context", () => {
  it("passes Copperleaf's VAT backward test in 2023 and not once it is registered", () => {
    const reg = data.copperleaf.engine.facts.find((f) => f.field === "vatRegistered" && f.value === true)!;
    // A month before the effective date, the last complete month is the one that tripped the test.
    const before = entityContext(data.copperleaf, addMonths(reg.appliesFrom, -1), params);
    expect(reg.appliesFrom < "2024-01-01").toBe(true);
    expect(before.ctx.fact.vatRegistered).toBe(false);
    expect(before.ctx.derived.vatBackwardTestMet).toBe(true);
    expect(entityContext(data.copperleaf, ASOF, params).ctx.fact.vatRegistered).toBe(true);
  });

  it("sizes Northgate as small and Copperleaf as micro", () => {
    expect(entityContext(data.northgate, ASOF, params).ctx.derived.companySize).toBe("small");
    expect(entityContext(data.copperleaf, ASOF, params).ctx.derived.companySize).toBe("micro");
  });

  it("reads Fenwick's MTD qualifying income from the 2024-25 return", () => {
    const sa = data.fenwick.filings.find((f) => f.kind === "selfAssessment" && f.periodEnd === "2025-04-05")!;
    expect(entityContext(data.fenwick, ASOF, params).ctx.derived.mtdQualifyingIncome).toBe(sa.figures.qualifyingIncome);
  });
});

describe("obligations calendar", () => {
  it("never gives a client work from an unverified rule", async () => {
    for (const d of Object.values(data)) {
      const cal = await calendar(d);
      const verified = new Set(rules.filter((r) => r.verified).map((r) => `${r.id}@${r.version}`));
      for (const t of cal.tasks.filter((x) => x.source === "rulesEngine" && x.audience === "client" && x.kind !== "notice")) {
        expect(verified.has(`${t.ruleId}@${t.ruleVersion}`), `${d.profile.key}: ${t.title}`).toBe(true);
      }
      expect(cal.tasks.some((t) => t.kind === "expertReview" && t.audience === "internal")).toBe(true);
    }
  });

  it("is idempotent: re-running, or running in two halves, gives the same tasks", async () => {
    const d = data.northgate;
    const dates = evaluationDates("2026-04-06", ASOF);
    const once = runEngine(d, rules, params, dates);
    const again = runEngine(d, rules, params, [...dates, ...dates]);
    expect(again.tasks.map((t) => t.key).sort()).toEqual(once.tasks.map((t) => t.key).sort());
    const mid = dates.indexOf("2026-07-31");
    const first = runEngine(d, rules, params, dates.slice(0, mid));
    const second = runEngine(d, rules, params, dates.slice(mid), first.states);
    const keys = new Set([...first.tasks, ...second.tasks].map((t) => t.key));
    expect([...keys].sort()).toEqual(once.tasks.map((t) => t.key).sort());
    expect(new Set(once.tasks.map((t) => t.key)).size).toBe(once.tasks.length);
  });

  it("puts Fenwick under MTD for Income Tax with the open quarter from HMRC", async () => {
    const cal = await calendar(data.fenwick);
    const quarter = cal.tasks.find((t) => t.source === "hmrc" && t.deadline === "2026-11-07")!;
    expect(quarter).toMatchObject({ status: "open", overdue: false, processKey: "selfAssessment", basis: { ruleId: "mtd-itsa-2026" } });
    // The rule's generic quarterly task is replaced by HMRC's dated ones.
    expect(cal.tasks.some((t) => t.ruleId === "mtd-itsa-2026" && t.obligationId === "four-quarterly-updates")).toBe(false);
    expect(cal.tasks.some((t) => t.ruleId === "mtd-itsa-2026" && t.obligationId === "digital-records")).toBe(true);
    expect(cal.tasks.some((t) => t.source === "companiesHouse")).toBe(false);
  });

  it("gives Northgate one accounts task from Companies House, plus the small-company rule", async () => {
    const cal = await calendar(data.northgate);
    const accounts = cal.tasks.filter((t) => t.source === "companiesHouse" && t.title.includes("annual accounts"));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ deadline: "2027-12-31", basis: { obligationId: "annual-accounts-within-9-months" } });
    expect(cal.tasks.some((t) => t.obligationId === "annual-accounts-within-9-months")).toBe(false);
    expect(cal.tasks.some((t) => t.ruleId === "company-small" && t.audience === "client")).toBe(true);
    expect(cal.tasks.filter((t) => t.source === "hmrc" && t.status === "done").length).toBeGreaterThan(10);
  });

  it("flags overdue against the run date", async () => {
    const cal = await calendar(data.copperleaf);
    for (const t of cal.tasks) expect(t.overdue).toBe(t.status === "open" && t.deadline !== undefined && t.deadline < ASOF);
  });
});

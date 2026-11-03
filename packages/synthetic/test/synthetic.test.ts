import { describe, expect, it } from "vitest";
import { addMonthsToMonth, loadParameters, parameterAt, vatBackwardTest } from "@geartrain/rules-engine";
import { allPlans, copperleaf, fenwick, generateClient, northgate, type ClientDataset } from "../src/index.ts";

const params = loadParameters();

const data: Record<string, ClientDataset> = Object.fromEntries(allPlans.map((p) => [p.profile.key, generateClient(p)]));
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

describe("determinism", () => {
  it("produces identical output for the same seed", () => {
    for (const plan of allPlans) expect(JSON.stringify(generateClient(plan))).toBe(JSON.stringify(data[plan.profile.key]));
  });
});

describe.each(allPlans.map((p) => p.profile.key))("invariants: %s", (key) => {
  const d = data[key]!;
  const bankIds = new Set(d.bankLines.map((b) => b.id));
  const bank = new Map(d.bankLines.map((b) => [b.id, b]));

  it("uses unique ids across every record type", () => {
    const ids = [...d.contacts, ...d.invoices, ...d.bills, ...d.purchaseOrders, ...d.bankLines, ...d.filings, ...d.letters, ...d.documents].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("adds up invoice and bill lines, in whole pence", () => {
    for (const x of [...d.invoices, ...d.bills]) {
      expect(sum(x.lines, (l) => l.netPence)).toBe(x.netPence);
      expect(sum(x.lines, (l) => l.vatPence)).toBe(x.vatPence);
      expect(x.netPence + x.vatPence).toBe(x.totalPence);
      expect(Number.isInteger(x.totalPence)).toBe(true);
    }
  });

  it("backs every payment with a bank line of the same amount, except a planted overpayment", () => {
    const overpaid = new Set(d.edgeCases.filter((e) => e.kind === "overpayment").flatMap((e) => e.refs));
    for (const inv of d.invoices)
      for (const p of inv.payments) {
        expect(bankIds.has(p.bankLineId)).toBe(true);
        if (overpaid.has(p.bankLineId)) expect(bank.get(p.bankLineId)!.amountPence).toBeGreaterThan(p.amountPence);
        else expect(bank.get(p.bankLineId)!.amountPence).toBe(p.amountPence);
      }
    for (const bill of d.bills)
      for (const p of bill.payments) expect(bank.get(p.bankLineId)!.amountPence).toBe(-p.amountPence);
  });

  it("marks paid invoices as fully paid", () => {
    for (const inv of d.invoices.filter((i) => i.status === "paid")) expect(sum(inv.payments, (p) => p.amountPence)).toBeGreaterThanOrEqual(inv.totalPence);
  });

  it("keeps the bank balance positive", () => {
    let bal = d.bankOpeningBalance.amountPence;
    for (const b of d.bankLines) {
      bal += b.amountPence;
      expect(bal, `balance after ${b.id} on ${b.date}`).toBeGreaterThan(0);
    }
  });

  it("links every bill to a document and every planted case to real records", () => {
    const docs = new Set(d.documents.map((x) => x.id));
    for (const b of d.bills) expect(docs.has(b.documentId)).toBe(true);
    const all = new Set([...d.invoices, ...d.bills, ...d.purchaseOrders, ...d.bankLines, ...d.letters, ...d.filings, ...d.employees, ...d.contacts, ...d.documents].map((x) => x.id));
    for (const e of d.edgeCases) for (const r of e.refs) expect(all.has(r), `${e.kind} ref ${r}`).toBe(true);
  });

  it("files nothing in the future, and nothing but payroll before its period ends", () => {
    for (const f of d.filings) {
      if (f.submittedOn) {
        expect(f.submittedOn <= "2026-10-31").toBe(true);
        // RTI: the FPS goes on or before payday, inside the tax month.
        if (f.kind !== "payeMonthly") expect(f.submittedOn > f.periodEnd, `${f.kind} ${f.periodEnd}`).toBe(true);
      }
    }
  });

  it("makes VAT box 3 = 1 + 2 and box 5 = 3 - 4", () => {
    for (const f of d.filings.filter((x) => x.kind === "vatReturn")) {
      const b = f.figures;
      expect(b.box3).toBe(b.box1! + b.box2!);
      expect(b.box5).toBe(b.box3! - b.box4!);
    }
  });
});

describe("the story each client tells", () => {
  it("Copperleaf registers for VAT when the backward test is first passed", () => {
    const d = data[copperleaf.profile.key]!;
    const regFact = d.engine.facts.find((f) => f.field === "vatRegistered" && f.value === true)!;
    expect(d.profile.entity.vatNumber).toMatch(/^GB999\d{6}$/);
    const turnover: Record<string, number> = {};
    for (const s of d.engine.series.filter((x) => x.series === "taxableTurnover")) turnover[s.month] = s.value;
    const months = Object.keys(turnover).sort();
    const first = months.find(
      (m) =>
        vatBackwardTest({ vatRegistered: false, taxableTurnoverByMonth: turnover, month: m, thresholds: parameterAt(params, "vat", `${m}-28`) }).kind !== "none",
    );
    expect(first).toBeDefined();
    expect(`${addMonthsToMonth(first!, 2)}-01`).toBe(regFact.appliesFrom);
    expect(d.letters.some((l) => l.subject.includes("VAT registration"))).toBe(true);
    expect(d.edgeCases.map((e) => e.kind)).toContain("lateVatReturn");
  });

  it("Fenwick passes the £50k MTD for Income Tax test on 2024-25 and has an open quarterly update", () => {
    const d = data[fenwick.profile.key]!;
    const sa = d.filings.find((f) => f.kind === "selfAssessment" && f.periodStart === "2024-04-06")!;
    expect(sa.figures.qualifyingIncome).toBeGreaterThan(50_000_00);
    const open = d.filings.filter((f) => f.kind === "mtdQuarterlyUpdate" && !f.submittedOn).map((f) => f.dueDate);
    expect(open).toContain("2026-11-07");
    expect(d.filings.some((f) => f.kind === "vatReturn")).toBe(false);
  });

  it("Northgate grows from a handful of staff to about forty, buying through purchase orders", () => {
    const d = data[northgate.profile.key]!;
    const hc = d.engine.series.filter((s) => s.series === "headcountEndOfMonth");
    expect(hc[0]!.value).toBeLessThanOrEqual(5);
    expect(hc.at(-1)!.value).toBeGreaterThanOrEqual(38);
    expect(d.employees.some((e) => e.leaveDate)).toBe(true);
    expect(d.purchaseOrders.length).toBeGreaterThan(300);
    expect(d.bills.filter((b) => b.purchaseOrderId).length).toBeGreaterThan(300);
    expect(d.edgeCases.map((e) => e.kind)).toEqual(expect.arrayContaining(["duplicateBill", "bankDetailsChange", "billWithoutPurchaseOrder"]));
  });

  it("gives every client several years of filings", () => {
    expect(data.fenwick!.filings.filter((f) => f.kind === "selfAssessment" && f.submittedOn).length).toBeGreaterThanOrEqual(3);
    for (const k of ["copperleaf", "northgate"]) {
      const d = data[k]!;
      expect(d.filings.filter((f) => f.kind === "annualAccounts").length).toBeGreaterThanOrEqual(3);
      expect(d.filings.filter((f) => f.kind === "ct600").length).toBeGreaterThanOrEqual(3);
      expect(d.payRuns.length).toBeGreaterThanOrEqual(50);
    }
  });
});

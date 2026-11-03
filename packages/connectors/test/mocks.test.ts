import { describe, expect, it } from "vitest";
import { copperleaf, fenwick, generateClient, northgate } from "@geartrain/synthetic";
import { MockCompaniesHouse, MockHmrc, MockXero, NotSupportedError } from "../src/index.ts";

const ASOF = "2026-11-03";
const cl = generateClient(copperleaf);
const ng = generateClient(northgate);
const fw = generateClient(fenwick);

describe("MockXero", () => {
  it("filters the ledger and never hands out its own objects", async () => {
    const xero = new MockXero(ng);
    const open = await xero.listInvoices({ status: ["authorised", "partlyPaid"] });
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((i) => i.status === "authorised" || i.status === "partlyPaid")).toBe(true);
    open[0]!.totalPence = 1;
    expect((await xero.listInvoices({ status: ["authorised", "partlyPaid"] }))[0]!.totalPence).not.toBe(1);
  });

  it("creates bills as drafts from an uploaded document and logs the writes", async () => {
    const xero = new MockXero(ng, () => "2026-11-03T09:00:00Z");
    const supplier = (await xero.listContacts({ kind: "supplier" }))[0]!;
    const doc = await xero.uploadDocument({ fileName: "inv-123.txt", mimeType: "text/plain", content: "INVOICE 123", receivedOn: ASOF, kind: "supplierInvoice" });
    const bill = await xero.createDraftBill({
      contactId: supplier.id,
      reference: "123",
      issueDate: ASOF,
      dueDate: "2026-12-03",
      lines: [{ description: "Bar stock", netPence: 10_000, vatPence: 2_000, accountCode: "310" }],
      documentId: doc.id,
    });
    expect(bill).toMatchObject({ status: "draft", totalPence: 12_000, documentId: doc.id });
    expect((await xero.listBills({ from: ASOF })).map((b) => b.id)).toContain(bill.id);
    expect(xero.writes.map((w) => w.operation)).toEqual(["uploadDocument", "createDraftBill"]);
    // The shared dataset is untouched.
    expect(ng.bills.some((b) => b.id === bill.id)).toBe(false);
  });

  it("rejects a bill to a customer, fractional pence and bank reconciliation", async () => {
    const xero = new MockXero(ng);
    const customer = (await xero.listContacts({ kind: "customer" }))[0]!;
    const line = { description: "x", netPence: 100, vatPence: 20, accountCode: "310" };
    await expect(xero.createDraftBill({ contactId: customer.id, reference: "r", issueDate: ASOF, dueDate: ASOF, lines: [line] })).rejects.toThrow(/not a supplier/);
    const supplier = (await xero.listContacts({ kind: "supplier" }))[0]!;
    await expect(
      xero.createDraftBill({ contactId: supplier.id, reference: "r", issueDate: ASOF, dueDate: ASOF, lines: [{ ...line, netPence: 100.5 }] }),
    ).rejects.toThrow(/whole pence/);
    await expect(xero.reconcileBankLine("x", { kind: "fee" })).rejects.toBeInstanceOf(NotSupportedError);
    expect(xero.capabilities.bankReconciliation).toBe(false);
  });
});

describe("MockHmrc", () => {
  it("shows Fenwick's MTD quarter due 7 November as open", async () => {
    const open = await new MockHmrc(fw, ASOF).obligations({ status: "O", regime: "itsaQuarterly" });
    expect(open.map((o) => o.due)).toContain("2026-11-07");
  });

  it("rolls VAT quarters forward to today and marks past returns fulfilled", async () => {
    const hmrc = new MockHmrc(cl, ASOF);
    const vat = await hmrc.obligations({ regime: "vat" });
    const open = vat.filter((o) => o.status === "O");
    expect(open.length).toBeGreaterThanOrEqual(1);
    expect(open.every((o) => o.start <= ASOF)).toBe(true);
    expect(vat.filter((o) => o.status === "F").every((o) => o.received !== undefined)).toBe(true);
    // Quarters follow on without gaps.
    const ends = vat.map((o) => o.end).sort();
    for (let i = 1; i < vat.length; i++) expect(vat.find((o) => o.end === ends[i])!.start > ends[i - 1]!).toBe(true);
  });

  it("refuses to submit anything to HMRC", async () => {
    await expect(new MockHmrc(cl, ASOF).submitReturn("vat", "x")).rejects.toBeInstanceOf(NotSupportedError);
  });
});

describe("MockCompaniesHouse", () => {
  const ch = new MockCompaniesHouse([fw, cl, ng], ASOF);

  it("gives next accounts and confirmation statement dates from the filing history", async () => {
    const p = (await ch.profile(ng.profile.entity.companyNumber!))!;
    expect(p.accounts).toMatchObject({ lastMadeUpTo: "2026-03-31", nextMadeUpTo: "2027-03-31", nextDue: "2027-12-31", overdue: false });
    expect(p.confirmationStatement.nextDue > ASOF).toBe(true);
    const history = await ch.filingHistory(ng.profile.entity.companyNumber!);
    expect(history.at(-1)!.type).toBe("IN01");
    expect(history.filter((h) => h.type === "AA").length).toBeGreaterThanOrEqual(4);
  });

  it("does not know sole traders", async () => {
    expect(await ch.profile("00000000")).toBeUndefined();
  });
});

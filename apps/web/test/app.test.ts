import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.tsx";
import { createDemoState, type DemoState } from "../src/state.ts";

const TODAY = "2026-11-03";
let state: DemoState;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  state = await createDemoState(TODAY, () => "2026-11-03T10:00:00.000Z");
  app = createApp(state);
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

describe("pages", () => {
  it.each(["/", "/clients/fenwick", "/clients/northgate/approvals", "/clients/copperleaf/documents", "/clients/copperleaf/ledger", "/clients/northgate/history", "/clients/fenwick/expert", "/audit"])(
    "renders %s",
    async (path) => {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Geartrain");
    },
  );

  it("returns 404 for an unknown client", async () => {
    expect((await app.request("/clients/nobody")).status).toBe(404);
  });

  it("shows Fenwick's MTD quarter on the calendar", async () => {
    const html = await (await app.request("/clients/fenwick")).text();
    expect(html).toContain("MTD quarterly update");
    expect(html).toContain("7 Nov 2026");
  });

  it("escapes document content", async () => {
    const cs = state.clients.get("fenwick")!;
    const doc = await cs.xero.uploadDocument({ fileName: "x.txt", mimeType: "text/plain", content: "<script>alert(1)</script>", receivedOn: TODAY, kind: "receipt" });
    const html = await (await app.request(`/clients/fenwick/documents/${doc.id}`)).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("approvals inbox", () => {
  it("holds the fake bank-details change until a call-back is recorded", async () => {
    const a = state.approvals.find((x) => x.kind === "supplierBankDetails")!;
    expect(a.risk).toBe("blocked");
    let res = await app.request(`/approvals/${a.id}`, { method: "POST", body: form({ decision: "approved", note: "ok" }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("err=");
    expect(a.status).toBe("pending");

    const note = "Called the supplier on the number in our records; accounts confirmed no change was requested.";
    res = await app.request(`/approvals/${a.id}`, { method: "POST", body: form({ decision: "rejected", note }) });
    expect(a).toMatchObject({ status: "rejected", decidedBy: "Demo user", note });
    expect(state.audit.at(-1)).toMatchObject({ action: "approval.rejected", refs: expect.arrayContaining([a.id]) });
  });

  it("records an approval once and refuses a second decision", async () => {
    const a = state.approvals.find((x) => x.kind === "payBills")!;
    await app.request(`/approvals/${a.id}`, { method: "POST", body: form({ decision: "approved" }) });
    expect(a.status).toBe("approved");
    const res = await app.request(`/approvals/${a.id}`, { method: "POST", body: form({ decision: "rejected" }) });
    expect(res.headers.get("location")).toContain("err=");
    expect(a.status).toBe("approved");
    expect(state.audit.filter((e) => e.refs.includes(a.id))).toHaveLength(1);
  });

  it("warns about the prompt injection and raises no approval from the phishing letter", () => {
    const inj = state.approvals.find((x) => x.clientKey === "copperleaf" && x.kind === "approveBill")!;
    expect(inj.warnings.join(" ")).toMatch(/ignored/);
    const phishing = state.clients.get("fenwick")!.data.edgeCases.find((e) => e.kind === "phishing")!;
    expect(state.approvals.some((x) => x.refs.some((r) => phishing.refs.includes(r)))).toBe(false);
  });
});

describe("document upload", () => {
  it("stores a text file through the ledger adapter and audits it", async () => {
    const f = new FormData();
    f.append("file", new File(["INVOICE 991\nTotal £120.00"], "invoice-991.txt", { type: "text/plain" }));
    f.append("kind", "supplierInvoice");
    const res = await app.request("/clients/northgate/documents", { method: "POST", body: f });
    expect(res.headers.get("location")).toContain("msg=");
    const event = state.audit.at(-1)!;
    expect(event).toMatchObject({ action: "document.uploaded", clientKey: "northgate" });
    const doc = await state.clients.get("northgate")!.xero.getDocument(event.refs[0]!);
    expect(doc?.content).toContain("INVOICE 991");
    expect(state.clients.get("northgate")!.xero.writes.map((w) => w.operation)).toEqual(["uploadDocument"]);
  });

  it("refuses non-text files and empty uploads", async () => {
    const f = new FormData();
    f.append("file", new File([new Uint8Array([37, 80, 68, 70])], "scan.pdf", { type: "application/pdf" }));
    let res = await app.request("/clients/northgate/documents", { method: "POST", body: f });
    expect(res.headers.get("location")).toContain("err=");
    res = await app.request("/clients/northgate/documents", { method: "POST", body: new FormData() });
    expect(res.headers.get("location")).toContain("err=");
    expect(state.audit).toHaveLength(0);
  });
});

describe("JSON API", () => {
  it("serves the calendar and approvals", async () => {
    const cal = (await (await app.request("/api/clients/fenwick/calendar")).json()) as { deadline?: string }[];
    expect(cal.some((t) => t.deadline === "2026-11-07")).toBe(true);
    const appr = (await (await app.request("/api/clients/northgate/approvals")).json()) as unknown[];
    expect(appr.length).toBeGreaterThanOrEqual(5);
  });
});

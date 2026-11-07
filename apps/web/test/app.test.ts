import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.tsx";
import { hashPassword, UserDirectory } from "../src/auth.ts";
import { createDemoState, type DemoState } from "../src/state.ts";

const TODAY = "2026-11-03";
const SECRET = "test-secret-test-secret-test-secret-123";
const PASSWORD = "a long test password";
let users: UserDirectory;
let state: DemoState;
let raw: ReturnType<typeof createApp>;
let cookie = "";

beforeAll(() => {
  const passwordHash = hashPassword(PASSWORD);
  users = new UserDirectory([
    { email: "staff@geartrain.example", name: "Sam Staff", role: "staff", clients: [], passwordHash },
    { email: "hannah@northgate.example", name: "Hannah Voss", role: "client", clients: ["northgate"], passwordHash },
  ]);
});

/** Same-origin requests carrying the signed-in session. */
const app = {
  request: (path: string, init: RequestInit = {}) =>
    raw.request(path, { ...init, headers: { origin: "http://localhost", ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string> | undefined) } }),
};

async function signIn(email: string, password = PASSWORD) {
  cookie = "";
  const res = await app.request("/login", { method: "POST", body: form({ email, password }) });
  const set = res.headers.get("set-cookie");
  cookie = set ? set.split(";")[0]! : "";
  return res;
}

beforeEach(async () => {
  state = await createDemoState(TODAY, () => "2026-11-03T10:00:00.000Z");
  raw = createApp(state, { users, sessionSecret: SECRET, secureCookies: true });
  await signIn("staff@geartrain.example");
  state.audit.length = 0;
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
    expect(a).toMatchObject({ status: "rejected", decidedBy: "Sam Staff <staff@geartrain.example>", note });
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

describe("sign-in", () => {
  it("sends anyone without a session to the sign-in page, and the API answers 401", async () => {
    cookie = "";
    const res = await app.request("/clients/northgate");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    expect((await app.request("/api/clients")).status).toBe(401);
    expect((await app.request("/login")).status).toBe(200);
  });

  it("sets an HttpOnly, Secure, SameSite cookie and refuses a wrong password", async () => {
    const ok = await signIn("STAFF@geartrain.example");
    expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(ok.headers.get("set-cookie")).toMatch(/Secure/);
    expect(ok.headers.get("set-cookie")).toMatch(/SameSite=Lax/);
    const bad = await signIn("staff@geartrain.example", "wrong password here");
    expect(bad.headers.get("location")).toContain("err=");
    expect(bad.headers.get("set-cookie")).toBeNull();
    expect(state.audit.at(-1)).toMatchObject({ action: "signin.failed" });
  });

  it("rejects a forged or tampered session cookie", async () => {
    await signIn("hannah@northgate.example");
    cookie = cookie.replace("hannah%40northgate.example", "staff%40geartrain.example").replace("hannah@northgate.example", "staff@geartrain.example");
    expect((await app.request("/audit")).status).toBe(303);
  });

  it("locks an email after five wrong passwords", async () => {
    for (let i = 0; i < 5; i++) await signIn("staff@geartrain.example", "wrong password here");
    const res = await signIn("staff@geartrain.example");
    expect(res.headers.get("location")).toContain("Too%20many");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("signs out", async () => {
    const res = await app.request("/logout", { method: "POST" });
    expect(res.headers.get("set-cookie")).toMatch(/gt_session=;/);
  });

  it("refuses a cross-site form post", async () => {
    const res = await raw.request("/approvals/apr-0001", { method: "POST", body: form({ decision: "approved" }), headers: { cookie, origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(state.approvals.find((a) => a.id === "apr-0001")!.status).toBe("pending");
  });
});

describe("a client user", () => {
  beforeEach(async () => {
    await signIn("hannah@northgate.example");
  });

  it("sees only their own company", async () => {
    const home = await (await app.request("/")).text();
    expect(home).toContain("Northgate Precision");
    expect(home).not.toContain("Copperleaf");
    expect(home).not.toContain("Fenwick");
    expect((await app.request("/clients/copperleaf")).status).toBe(404);
    expect((await app.request("/api/clients/copperleaf/calendar")).status).toBe(404);
    expect((await app.request("/api/clients/copperleaf/approvals")).status).toBe(404);
    expect(((await (await app.request("/api/clients")).json()) as { key: string }[]).map((c) => c.key)).toEqual(["northgate"]);
  });

  it("cannot decide another client's approval", async () => {
    const other = state.approvals.find((a) => a.clientKey === "copperleaf")!;
    const res = await app.request(`/approvals/${other.id}`, { method: "POST", body: form({ decision: "approved" }) });
    expect(res.status).toBe(404);
    expect(other.status).toBe("pending");
  });

  it("has no expert queue or audit trail", async () => {
    expect((await app.request("/clients/northgate/expert")).status).toBe(404);
    expect((await app.request("/audit")).status).toBe(404);
    expect(await (await app.request("/clients/northgate")).text()).not.toContain("Expert queue");
  });

  it("is named in the audit trail for what they do", async () => {
    const a = state.approvals.find((x) => x.clientKey === "northgate" && x.kind === "payBills")!;
    await app.request(`/approvals/${a.id}`, { method: "POST", body: form({ decision: "approved" }) });
    expect(state.audit.at(-1)).toMatchObject({ actor: "Hannah Voss <hannah@northgate.example>", action: "approval.approved" });
  });
});

describe("accounts", () => {
  it("refuses plain-text passwords and short passwords", () => {
    expect(() => new UserDirectory([{ email: "a@b.example", name: "A", role: "staff", clients: [], passwordHash: "hunter2" }])).toThrow(/scrypt/);
    expect(() => hashPassword("short")).toThrow(/12/);
  });

  it("refuses to start with a short session secret", () => {
    expect(() => createApp(state, { users, sessionSecret: "too short", secureCookies: true })).toThrow(/32/);
  });
});

describe("intake agent on upload", () => {
  async function uploadWith(model: import("@geartrain/agents").Model, content: string) {
    const runs: Promise<void>[] = [];
    raw = createApp(state, { users, sessionSecret: SECRET, secureCookies: true }, { model, onRun: (r) => runs.push(r) });
    const f = new FormData();
    f.append("file", new File([content], "letter.txt", { type: "text/plain" }));
    f.append("kind", "letter");
    const res = await app.request("/clients/northgate/documents", { method: "POST", body: f });
    await Promise.all(runs);
    const docId = state.audit.find((e) => e.action === "document.uploaded")!.refs[0]!;
    return { res, docId };
  }

  it("raises a bank-details request as a blocked approval, never changes it, and shows the agent's note", async () => {
    const { call, say, ScriptedModel } = await import("@geartrain/agents");
    const supplier = (await state.clients.get("northgate")!.xero.listContacts({ kind: "supplier" }))[0]!;
    const model = new ScriptedModel([
      [call("change_supplier_bank_details", { contactId: supplier.id, newAccountAsWritten: "11-22-33 44556677" }), call("flag_for_review", { reason: "Asks to change bank details", warnings: ["Call the supplier first"] })],
      [say("This letter asks to change bank details. Nothing was changed; it is with your team to verify.")],
    ]);
    const before = state.approvals.length;
    const { res, docId } = await uploadWith(model, "New bank details: 11-22-33 44556677");
    expect(res.headers.get("location")).toContain("reading");
    const raised = state.approvals.slice(before);
    expect(raised.map((a) => [a.kind, a.risk, a.status])).toEqual([
      ["supplierBankDetails", "blocked", "pending"],
      ["reviewDocument", "reversible", "pending"],
    ]);
    expect(raised[0]!.requiresVerification).toMatch(/Call the supplier/);
    expect((await state.clients.get("northgate")!.xero.getContact(supplier.id))!.bankAccount).not.toBe("11-22-33 44556677");
    expect(state.audit.filter((e) => e.action === "approval.raised")).toHaveLength(2);
    const page = await (await app.request(`/clients/northgate/documents/${docId}`)).text();
    expect(page).toContain("Nothing was changed");
    expect(page).toContain(raised[0]!.id);
  });

  it("records a failed run and leaves the document for a person", async () => {
    const { ScriptedModel } = await import("@geartrain/agents");
    const { docId } = await uploadWith(new ScriptedModel([]), "anything");
    expect(state.agentNotes.get(docId)!.status).toBe("failed");
    expect(state.audit.at(-1)).toMatchObject({ action: "agent.failed", refs: [docId] });
  });

  it("stores only, and says so, when no model is configured", async () => {
    const f = new FormData();
    f.append("file", new File(["hello"], "a.txt", { type: "text/plain" }));
    const res = await app.request("/clients/northgate/documents", { method: "POST", body: f });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("switched off");
    expect(state.agentNotes.size).toBe(0);
  });
});

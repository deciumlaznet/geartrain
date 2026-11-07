/** @jsxImportSource hono/jsx */
// Routes for the demo web app. Pages are server-rendered; /api returns the same
// data as JSON for the Smartsheet sync and the agents.

import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import type { Model } from "@geartrain/agents";
import { NotSupportedError } from "@geartrain/connectors";
import { processDocument } from "./agents.ts";
import { canSeeClient, LoginThrottle, SESSION_COOKIE, SESSION_HOURS, type User, type UserDirectory } from "./auth.ts";
import { decide, DecisionError, type DemoState } from "./state.ts";
import { ApprovalCard, AuditTable, ClientPage, gbp, Home, Layout, LoginPage, longDate, TaskTable } from "./views.tsx";

const MAX_UPLOAD_BYTES = 1_000_000;
const DOC_KINDS = ["supplierInvoice", "receipt", "letter", "bankStatement", "contract"] as const;

export interface AuthOptions {
  users: UserDirectory;
  /** At least 32 characters; from the SESSION_SECRET secret. */
  sessionSecret: string;
  /** Send the cookie over HTTPS only. On for anything but local development. */
  secureCookies: boolean;
  throttle?: LoginThrottle;
}

export interface AgentOptions {
  /** The model behind the agents. Without one (no ANTHROPIC_API_KEY), uploads are stored only. */
  model?: Model;
  /** Called with each background agent run, so tests can wait for it. */
  onRun?: (run: Promise<void>) => void;
}

type Env = { Variables: { user: User } };

export function createApp(state: DemoState, auth: AuthOptions, agents: AgentOptions = {}) {
  if (auth.sessionSecret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  const app = new Hono<Env>();
  const throttle = auth.throttle ?? new LoginThrottle();
  const notFound = () => new Response("Not found", { status: 404 });
  const actor = (c: Context<Env>) => `${c.get("user").name} <${c.get("user").email}>`;
  /** A client the signed-in user may see; anything else is a 404, so other clients' names never leak. */
  const clientFor = (c: Context<Env>, key: string) => (canSeeClient(c.get("user"), key) ? state.clients.get(key) : undefined);
  const visibleState = (user: User): DemoState => ({
    ...state,
    clients: new Map([...state.clients].filter(([k]) => canSeeClient(user, k))),
    approvals: state.approvals.filter((a) => canSeeClient(user, a.clientKey)),
  });

  app.use("*", secureHeaders());
  app.use("*", csrf());

  // ---- Sign-in -------------------------------------------------------------

  app.get("/login", (c) => c.html(<LoginPage today={state.today} err={c.req.query("err")} />));

  app.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fail = (msg: string) => c.redirect(`/login?err=${encodeURIComponent(msg)}`, 303);
    if (throttle.locked(email)) return fail("Too many attempts. Try again in 15 minutes.");
    const user = email && password ? auth.users.authenticate(email, password) : undefined;
    if (!user) {
      throttle.fail(email);
      state.audit.push({ at: state.now(), actor: email || "(blank)", clientKey: "-", action: "signin.failed", refs: [] });
      return fail("That email and password don't match an account.");
    }
    throttle.clear(email);
    const expires = Date.now() + SESSION_HOURS * 3_600_000;
    await setSignedCookie(c, SESSION_COOKIE, `${user.email}|${expires}`, auth.sessionSecret, {
      httpOnly: true,
      secure: auth.secureCookies,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_HOURS * 3600,
    });
    state.audit.push({ at: state.now(), actor: `${user.name} <${user.email}>`, clientKey: "-", action: "signin", refs: [] });
    return c.redirect("/", 303);
  });

  app.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: auth.secureCookies });
    return c.redirect("/login", 303);
  });

  const requireUser: MiddlewareHandler<Env> = async (c, next) => {
    const raw = await getSignedCookie(c, auth.sessionSecret, SESSION_COOKIE);
    const [email, expires] = typeof raw === "string" ? raw.split("|") : [];
    const user = email && Number(expires) > Date.now() ? auth.users.get(email) : undefined;
    if (!user) {
      if (c.req.path.startsWith("/api/")) return c.json({ error: "Sign in required" }, 401);
      return c.redirect("/login", 303);
    }
    c.set("user", user);
    await next();
  };
  app.use("*", requireUser);

  const staffOnly: MiddlewareHandler<Env> = async (c, next) => {
    if (c.get("user").role !== "staff") return notFound();
    await next();
  };

  app.get("/", (c) => c.html(<Home state={visibleState(c.get("user"))} user={c.get("user")} />));

  app.get("/clients/:key", (c) => {
    const cs = clientFor(c, c.req.param("key"));
    if (!cs) return notFound();
    const open = cs.calendar.tasks.filter((t) => t.status === "open" && t.audience === "client");
    return c.html(
      <ClientPage state={state} user={c.get("user")} c={cs} tab="">
        <h2>Overdue</h2>
        <TaskTable tasks={open.filter((t) => t.overdue)} />
        <h2>Coming up</h2>
        <TaskTable tasks={open.filter((t) => !t.overdue)} />
      </ClientPage>,
    );
  });

  app.get("/clients/:key/approvals", (c) => {
    const cs = clientFor(c, c.req.param("key"));
    if (!cs) return notFound();
    const mine = state.approvals.filter((a) => a.clientKey === cs.data.profile.key);
    const pending = mine.filter((a) => a.status === "pending");
    const decided = mine.filter((a) => a.status !== "pending");
    return c.html(
      <ClientPage state={state} user={c.get("user")} c={cs} tab="approvals" msg={c.req.query("msg")} err={c.req.query("err")}>
        <p class="sub">Anything that moves money, reaches someone new or changes bank details waits here for a person.</p>
        <h2>Waiting for you</h2>
        {pending.length ? pending.map((a) => <ApprovalCard a={a} />) : <p class="sub">Nothing to approve.</p>}
        {decided.length ? (
          <>
            <h2>Decided</h2>
            {decided.map((a) => (
              <ApprovalCard a={a} />
            ))}
          </>
        ) : null}
      </ClientPage>,
    );
  });

  app.post("/approvals/:id", async (c) => {
    const a = state.approvals.find((x) => x.id === c.req.param("id"));
    if (!a || !canSeeClient(c.get("user"), a.clientKey)) return notFound();
    const body = await c.req.parseBody();
    const decision = body.decision === "approved" ? "approved" : body.decision === "rejected" ? "rejected" : undefined;
    const back = `/clients/${a.clientKey}/approvals`;
    if (!decision) return c.redirect(`${back}?err=${encodeURIComponent("Choose approve or reject")}`, 303);
    try {
      decide(state, a.id, decision, actor(c), typeof body.note === "string" ? body.note : undefined);
      return c.redirect(`${back}?msg=${encodeURIComponent(`${decision === "approved" ? "Approved" : "Rejected"}: ${a.title}`)}`, 303);
    } catch (e) {
      if (e instanceof DecisionError) return c.redirect(`${back}?err=${encodeURIComponent(e.message)}`, 303);
      throw e;
    }
  });

  app.get("/clients/:key/documents", async (c) => {
    const cs = clientFor(c, c.req.param("key"));
    if (!cs) return notFound();
    const uploaded = state.audit.filter((e) => e.clientKey === cs.data.profile.key && e.action === "document.uploaded").flatMap((e) => e.refs);
    const docs = await Promise.all(uploaded.map((id) => cs.xero.getDocument(id)));
    const recent = [...cs.data.documents].sort((a, b) => (a.receivedOn < b.receivedOn ? 1 : -1)).slice(0, 25);
    return c.html(
      <ClientPage state={state} user={c.get("user")} c={cs} tab="documents" msg={c.req.query("msg")} err={c.req.query("err")}>
        <div class="card">
          <h3>Upload a document</h3>
          <p class="sub">Supplier invoices, receipts and letters go to the agent for processing. The demo takes plain-text files up to 1 MB.</p>
          <form class="inline" method="post" action={`/clients/${cs.data.profile.key}/documents`} enctype="multipart/form-data">
            <input type="file" name="file" accept=".txt,text/plain" required />
            <select name="kind">
              {DOC_KINDS.map((k) => (
                <option value={k}>{k}</option>
              ))}
            </select>
            <button>Upload</button>
          </form>
        </div>
        {docs.length ? (
          <>
            <h2>Uploaded in this session</h2>
            <DocTable keyName={cs.data.profile.key} docs={docs.filter((d) => d !== undefined)} />
          </>
        ) : null}
        <h2>Recent documents</h2>
        <DocTable keyName={cs.data.profile.key} docs={recent} />
      </ClientPage>,
    );
  });

  app.post("/clients/:key/documents", async (c) => {
    const cs = clientFor(c, c.req.param("key"));
    if (!cs) return notFound();
    const back = `/clients/${cs.data.profile.key}/documents`;
    const body = await c.req.parseBody();
    const file = body.file;
    const kind = DOC_KINDS.find((k) => k === body.kind) ?? "supplierInvoice";
    if (!(file instanceof File) || file.size === 0) return c.redirect(`${back}?err=${encodeURIComponent("Choose a file to upload")}`, 303);
    if (file.size > MAX_UPLOAD_BYTES) return c.redirect(`${back}?err=${encodeURIComponent("That file is over 1 MB")}`, 303);
    try {
      const doc = await cs.xero.uploadDocument({
        fileName: file.name.replace(/[^\w.\- ]/g, "_").slice(0, 120),
        mimeType: file.type || "text/plain",
        content: await file.text(),
        receivedOn: state.today,
        kind,
      });
      state.audit.push({ at: state.now(), actor: actor(c), clientKey: cs.data.profile.key, action: "document.uploaded", refs: [doc.id], detail: doc.fileName });
      if (agents.model) {
        const run = processDocument(state, agents.model, cs, doc);
        agents.onRun?.(run);
      }
      const next = agents.model ? "The intake agent is reading it now." : "Agents are switched off in this demo, so it is stored only.";
      return c.redirect(`${back}?msg=${encodeURIComponent(`Uploaded ${doc.fileName}. ${next}`)}`, 303);
    } catch (e) {
      if (e instanceof NotSupportedError) return c.redirect(`${back}?err=${encodeURIComponent("The demo takes plain-text files only")}`, 303);
      throw e;
    }
  });

  app.get("/clients/:key/documents/:id", async (c) => {
    const cs = clientFor(c, c.req.param("key"));
    const doc = cs ? await cs.xero.getDocument(c.req.param("id")) : undefined;
    if (!cs || !doc) return notFound();
    return c.html(
      <ClientPage state={state} user={c.get("user")} c={cs} tab="documents">
        <h2>{doc.fileName}</h2>
        <p class="sub">
          {doc.kind} · received {longDate(doc.receivedOn)}
        </p>
        <AgentNoteView note={state.agentNotes.get(doc.id)} keyName={cs.data.profile.key} />
        <pre>{doc.content}</pre>
      </ClientPage>,
    );
  });

  app.get("/clients/:key/ledger", async (c) => {
    const cs = clientFor(c, c.req.param("key"));
    if (!cs) return notFound();
    const contacts = new Map((await cs.xero.listContacts()).map((x) => [x.id, x.name]));
    const open = (await cs.xero.listInvoices({ status: ["authorised", "partlyPaid"] })).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const unreconciled = await cs.xero.listBankLines({ unreconciled: true });
    const days = (d: string) => Math.round((Date.parse(state.today) - Date.parse(d)) / 86_400_000);
    const owed = (i: (typeof open)[number]) => i.totalPence - i.payments.reduce((s, p) => s + p.amountPence, 0);
    return c.html(
      <ClientPage state={state} user={c.get("user")} c={cs} tab="ledger">
        <h2>Unpaid invoices ({gbp(open.reduce((s, i) => s + owed(i), 0))})</h2>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Due</th>
                <th class="num">Owed</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {open.map((i) => (
                <tr>
                  <td>{i.number}</td>
                  <td>{contacts.get(i.contactId)}</td>
                  <td>{longDate(i.dueDate)}</td>
                  <td class="num">{gbp(owed(i))}</td>
                  <td>{days(i.dueDate) > 0 ? <span class="tag over">{days(i.dueDate)} days late</span> : <span class="tag">not due</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2>Bank lines to reconcile in Xero</h2>
        <p class="sub">Xero's API cannot reconcile bank lines, so a person does this in Xero; the agent suggests the match.</p>
        {unreconciled.length ? (
          <table>
            <tbody>
              {unreconciled.map((b) => (
                <tr>
                  <td>{longDate(b.date)}</td>
                  <td>{b.description}</td>
                  <td class="num">{gbp(b.amountPence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="sub">All reconciled.</p>
        )}
      </ClientPage>,
    );
  });

  app.get("/clients/:key/history", (c) => {
    const cs = clientFor(c, c.req.param("key"));
    if (!cs) return notFound();
    const filings = cs.data.filings.filter((f) => f.submittedOn && f.kind !== "payeMonthly").sort((a, b) => (a.submittedOn! < b.submittedOn! ? 1 : -1));
    return c.html(
      <ClientPage state={state} user={c.get("user")} c={cs} tab="history">
        <h2>Filed returns and accounts</h2>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>Filed</th>
                <th>What</th>
                <th>Period</th>
                <th>Due</th>
                <th class="num">Liability</th>
              </tr>
            </thead>
            <tbody>
              {filings.map((f) => (
                <tr>
                  <td>
                    {longDate(f.submittedOn!)} {f.submittedOn! > f.dueDate ? <span class="tag over">late</span> : null}
                  </td>
                  <td>{f.kind}</td>
                  <td>
                    {longDate(f.periodStart)} to {longDate(f.periodEnd)}
                  </td>
                  <td>{longDate(f.dueDate)}</td>
                  <td class="num">{f.liabilityPence !== undefined ? gbp(f.liabilityPence) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ClientPage>,
    );
  });

  app.get("/clients/:key/expert", staffOnly, (c) => {
    const cs = clientFor(c, c.req.param("key"));
    if (!cs) return notFound();
    const internal = cs.calendar.tasks.filter((t) => t.audience === "internal" && t.status === "open");
    return c.html(
      <ClientPage state={state} user={c.get("user")} c={cs} tab="expert">
        <p class="sub">Internal only. Rules not yet verified by an expert raise review tasks here instead of client work; missing facts are asked for here.</p>
        <TaskTable tasks={internal} />
      </ClientPage>,
    );
  });

  app.get("/audit", staffOnly, (c) =>
    c.html(
      <Layout title="Audit trail" today={state.today} user={c.get("user")}>
        <h1>Audit trail</h1>
        <p class="sub">Every decision and upload, in order. Append-only.</p>
        <AuditTable events={state.audit} />
      </Layout>,
    ),
  );

  // JSON for the Smartsheet sync and the agents.
  app.get("/api/clients", (c) => c.json([...visibleState(c.get("user")).clients.values()].map((x) => ({ key: x.data.profile.key, name: x.data.profile.clientName, legalForm: x.data.profile.entity.legalForm }))));
  app.get("/api/clients/:key/calendar", (c) => {
    const cs = clientFor(c, c.req.param("key"));
    return cs ? c.json(cs.calendar.tasks) : notFound();
  });
  app.get("/api/clients/:key/approvals", (c) => {
    const cs = clientFor(c, c.req.param("key"));
    return cs ? c.json(state.approvals.filter((a) => a.clientKey === cs.data.profile.key)) : notFound();
  });

  return app;
}

const DocTable = (p: { keyName: string; docs: { id: string; fileName: string; kind: string; receivedOn: string }[] }) => (
  <div class="scroll">
    <table>
      <tbody>
        {p.docs.map((d) => (
          <tr>
            <td>{longDate(d.receivedOn)}</td>
            <td>
              <a href={`/clients/${p.keyName}/documents/${d.id}`}>{d.fileName}</a>
            </td>
            <td>
              <span class="tag">{d.kind}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const AgentNoteView = (p: { note: import("./state.ts").AgentNote | undefined; keyName: string }) => {
  if (!p.note) return null;
  const { note } = p;
  return (
    <div class="card">
      <strong>Intake agent:</strong>{" "}
      {note.status === "working" ? "reading this document now. Refresh in a moment." : note.summary}
      {note.draftBillIds.length > 0 && <p class="sub">Draft bills: {note.draftBillIds.join(", ")} (drafts only; nothing is approved or paid).</p>}
      {note.approvalIds.length > 0 && (
        <p class="sub">
          Raised for a person: <a href={`/clients/${p.keyName}/approvals`}>{note.approvalIds.join(", ")}</a>
        </p>
      )}
    </div>
  );
};

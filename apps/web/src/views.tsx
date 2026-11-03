/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import type { CalendarTask } from "@geartrain/worker";
import type { Approval, AuditEvent, ClientState, DemoState } from "./state.ts";

export const gbp = (pence: number) =>
  (pence < 0 ? "-£" : "£") + (Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

const CSS = `
:root{--bg:#f7f6f2;--panel:#fff;--ink:#1d2327;--muted:#5d666d;--line:#e2e0d8;--accent:#0f6e5c;--warn:#a4441b;--warnbg:#fbeee6;--ok:#2d6a2f;--chip:#eef3f1}
@media (prefers-color-scheme:dark){:root{--bg:#15191b;--panel:#1d2326;--ink:#e8eaeb;--muted:#a0a9ae;--line:#30383c;--accent:#4fc1a6;--warn:#f0956a;--warnbg:#3a2419;--ok:#8fd193;--chip:#23302c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}header{background:var(--panel);border-bottom:1px solid var(--line)}
.wrap{max-width:1080px;margin:0 auto;padding:0 16px}
.top{display:flex;align-items:center;gap:16px;height:56px}.brand{font-weight:700;font-size:18px;color:var(--ink);text-decoration:none;display:flex;gap:8px;align-items:center}
.demo{margin-left:auto;font-size:12px;color:var(--muted)}
nav.tabs{display:flex;gap:4px;flex-wrap:wrap;margin:16px 0}nav.tabs a{padding:6px 12px;border-radius:999px;text-decoration:none;color:var(--muted)}nav.tabs a.on{background:var(--chip);color:var(--ink);font-weight:600}
h1{font-size:24px;margin:24px 0 4px}h2{font-size:17px;margin:28px 0 8px}.sub{color:var(--muted);margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin:16px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
.card h3{margin:0 0 4px;font-size:16px}.stat{display:flex;gap:16px;margin-top:12px;font-size:13px;color:var(--muted)}.stat b{display:block;font-size:20px;color:var(--ink)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted);font-weight:600}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;background:var(--chip);color:var(--muted)}
.tag.over{background:var(--warnbg);color:var(--warn)}.tag.done{color:var(--ok)}
.warn{background:var(--warnbg);color:var(--warn);border-radius:8px;padding:8px 12px;margin:8px 0;font-size:14px}
form.inline{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
input[type=text],select,textarea{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink)}
textarea{width:100%;min-height:60px}
button{font:inherit;padding:6px 14px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button.secondary{background:transparent;color:var(--accent)}
pre{white-space:pre-wrap;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px}
.flash{padding:10px 14px;border-radius:8px;margin:12px 0;background:var(--chip)}.flash.err{background:var(--warnbg);color:var(--warn)}
.scroll{overflow-x:auto}
`;

const Cog = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
    />
  </svg>
);

export const Layout = (p: { title: string; today: string; children: Child }) => (
  <html lang="en-GB">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{p.title} · Geartrain</title>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </head>
    <body>
      <header>
        <div class="wrap top">
          <a class="brand" href="/">
            <Cog /> Geartrain
          </a>
          <a href="/audit">Audit trail</a>
          <span class="demo">Demo environment · fake clients · today is {longDate(p.today)}</span>
        </div>
      </header>
      <main class="wrap">{p.children}</main>
    </body>
  </html>
);

export const Flash = (p: { msg?: string | undefined; err?: string | undefined }) => (
  <>
    {p.msg ? <div class="flash">{p.msg}</div> : null}
    {p.err ? <div class="flash err">{p.err}</div> : null}
  </>
);

export function clientSummary(c: ClientState, approvals: Approval[]) {
  const open = c.calendar.tasks.filter((t) => t.status === "open" && t.audience === "client");
  return {
    open: open.length,
    overdue: open.filter((t) => t.overdue).length,
    next: open.find((t) => t.deadline && !t.overdue),
    pending: approvals.filter((a) => a.clientKey === c.data.profile.key && a.status === "pending").length,
  };
}

export const Home = (p: { state: DemoState }) => (
  <Layout title="Clients" today={p.state.today}>
    <h1>Clients</h1>
    <p class="sub">Each client's obligations calendar, the decisions waiting for them, and their books.</p>
    <div class="grid">
      {[...p.state.clients.values()].map((c) => {
        const s = clientSummary(c, p.state.approvals);
        const e = c.data.profile.entity;
        return (
          <div class="card">
            <h3>
              <a href={`/clients/${c.data.profile.key}`}>{c.data.profile.clientName}</a>
            </h3>
            <div class="sub">
              {e.legalForm === "ltd" ? `Limited company ${e.companyNumber}` : "Sole trader"}
              {e.vatNumber ? ` · VAT ${e.vatNumber}` : ""}
            </div>
            <div class="stat">
              <span>
                <b>{s.open}</b>open tasks
              </span>
              <span>
                <b>{s.overdue}</b>overdue
              </span>
              <span>
                <b>{s.pending}</b>to approve
              </span>
            </div>
            {s.next ? (
              <p class="sub" style="margin-top:12px">
                Next: {s.next.title}, {longDate(s.next.deadline!)}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  </Layout>
);

const TABS = [
  ["", "Calendar"],
  ["approvals", "Approvals"],
  ["documents", "Documents"],
  ["ledger", "Money owed"],
  ["history", "Track record"],
  ["expert", "Expert queue"],
] as const;

export const ClientPage = (p: { state: DemoState; c: ClientState; tab: string; children: Child; msg?: string | undefined; err?: string | undefined }) => {
  const key = p.c.data.profile.key;
  const pending = p.state.approvals.filter((a) => a.clientKey === key && a.status === "pending").length;
  return (
    <Layout title={p.c.data.profile.clientName} today={p.state.today}>
      <h1>{p.c.data.profile.clientName}</h1>
      <p class="sub">{p.c.data.profile.entity.name}</p>
      <nav class="tabs">
        {TABS.map(([path, label]) => (
          <a class={p.tab === path ? "on" : ""} href={`/clients/${key}${path ? `/${path}` : ""}`}>
            {label}
            {path === "approvals" && pending ? ` (${pending})` : ""}
          </a>
        ))}
      </nav>
      <Flash msg={p.msg} err={p.err} />
      {p.children}
    </Layout>
  );
};

const SOURCE: Record<CalendarTask["source"], string> = { rulesEngine: "Rule", hmrc: "HMRC", companiesHouse: "Companies House" };

export const TaskTable = (p: { tasks: CalendarTask[]; showDone?: boolean }) =>
  p.tasks.length === 0 ? (
    <p class="sub">Nothing here.</p>
  ) : (
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Due</th>
            <th>What</th>
            <th>From</th>
            <th>Who</th>
          </tr>
        </thead>
        <tbody>
          {p.tasks.map((t) => (
            <tr>
              <td>
                {t.deadline ? longDate(t.deadline) : "No date yet"}
                {t.overdue ? (
                  <>
                    {" "}
                    <span class="tag over">overdue</span>
                  </>
                ) : null}
                {t.status === "done" ? (
                  <>
                    {" "}
                    <span class="tag done">done {t.completedOn ? longDate(t.completedOn) : ""}</span>
                  </>
                ) : null}
              </td>
              <td>
                {t.title}
                {t.note ? <div class="sub">{t.note}</div> : null}
              </td>
              <td>
                <span class="tag">{SOURCE[t.source]}</span>
              </td>
              <td>{MODE[t.mode]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

const MODE: Record<string, string> = { agent: "Agent", signoff: "Agent drafts, you sign off", interplay: "Agent and you", human: "You (or your adviser)" };

export const ApprovalCard = (p: { a: Approval }) => {
  const a = p.a;
  return (
    <div class="card" style="margin-bottom:12px">
      <h3>{a.title}</h3>
      <div class="sub">
        {a.amountPence !== undefined ? `${gbp(a.amountPence)} · ` : ""}raised by {a.raisedBy} on {longDate(a.raisedOn)}
      </div>
      <p>{a.detail}</p>
      {a.warnings.map((w) => (
        <div class="warn">{w}</div>
      ))}
      {a.status === "pending" ? (
        <form method="post" action={`/approvals/${a.id}`}>
          {a.requiresVerification ? (
            <label>
              <span class="sub">Before approving, {a.requiresVerification}. Record who you spoke to, the number you called and when.</span>
              <textarea name="note"></textarea>
            </label>
          ) : (
            <input type="text" name="note" placeholder="Note (optional)" style="width:100%" />
          )}
          <div class="inline" style="display:flex;gap:8px;margin-top:8px">
            <button name="decision" value="approved">
              Approve
            </button>
            <button class="secondary" name="decision" value="rejected">
              Reject
            </button>
          </div>
        </form>
      ) : (
        <p class="sub">
          {a.status === "approved" ? "Approved" : "Rejected"} by {a.decidedBy}
          {a.note ? `: ${a.note}` : ""}
        </p>
      )}
    </div>
  );
};

export const AuditTable = (p: { events: AuditEvent[] }) =>
  p.events.length === 0 ? (
    <p class="sub">No actions yet in this session.</p>
  ) : (
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>Who</th>
          <th>Client</th>
          <th>Action</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {[...p.events].reverse().map((e) => (
          <tr>
            <td>{e.at.replace("T", " ").slice(0, 19)}</td>
            <td>{e.actor}</td>
            <td>{e.clientKey}</td>
            <td>{e.action}</td>
            <td>
              {e.refs.join(", ")}
              {e.detail ? <div class="sub">{e.detail}</div> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

export { longDate };

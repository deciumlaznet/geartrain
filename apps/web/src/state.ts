// The demo's in-memory state: the fake clients, their stand-in services, their
// calendars, the approvals inbox and the audit trail. A Postgres-backed store
// replaces this once the database is wired in; the routes only use this
// interface.

import { MockCompaniesHouse, MockHmrc, MockXero } from "@geartrain/connectors";
import { loadParameters, loadRuleFile, type ISODate } from "@geartrain/rules-engine";
import { allPlans, generateClient, type ClientDataset } from "@geartrain/synthetic";
import { buildCalendar, type Calendar } from "@geartrain/worker";
import { seedApprovals } from "./seed.ts";

export type RiskClass = "read" | "reversible" | "externalFinancial" | "blocked";

export interface Approval {
  id: string;
  clientKey: string;
  kind: "payBills" | "approveBill" | "discardDuplicate" | "supplierBankDetails" | "sendFinalNotice" | "reviewDocument";
  title: string;
  detail: string;
  amountPence?: number;
  risk: RiskClass;
  /** Things the approver must know before deciding. */
  warnings: string[];
  refs: string[];
  raisedBy: string;
  raisedOn: ISODate;
  /** For blocked items: what has to happen outside the app first. */
  requiresVerification?: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

export interface AuditEvent {
  at: string;
  actor: string;
  clientKey: string;
  action: string;
  refs: string[];
  detail?: string;
}

export interface ClientState {
  data: ClientDataset;
  xero: MockXero;
  hmrc: MockHmrc;
  calendar: Calendar;
}

/** What the intake agent did with an uploaded document. */
export interface AgentNote {
  documentId: string;
  clientKey: string;
  status: "working" | "done" | "failed";
  summary?: string;
  draftBillIds: string[];
  approvalIds: string[];
}

export interface DemoState {
  today: ISODate;
  clients: Map<string, ClientState>;
  approvals: Approval[];
  audit: AuditEvent[];
  agentNotes: Map<string, AgentNote>;
  now: () => string;
}

export async function createDemoState(today: ISODate, now: () => string = () => new Date().toISOString()): Promise<DemoState> {
  const rules = loadRuleFile().rules;
  const params = loadParameters();
  const datasets = allPlans.map((p) => generateClient(p));
  const companiesHouse = new MockCompaniesHouse(datasets, today);
  const clients = new Map<string, ClientState>();
  for (const data of datasets) {
    const hmrc = new MockHmrc(data, today);
    const calendar = await buildCalendar(data, { rules, params, onboardedOn: "2026-10-01", asOf: today, hmrc, companiesHouse });
    clients.set(data.profile.key, { data, xero: new MockXero(data, now), hmrc, calendar });
  }
  return { today, clients, approvals: seedApprovals(datasets, today), audit: [], agentNotes: new Map(), now };
}

export class DecisionError extends Error {}

/** Records a decision. Blocked items need a verification note; nothing is decided twice. */
export function decide(
  state: DemoState,
  id: string,
  decision: "approved" | "rejected",
  actor: string,
  note?: string,
): Approval {
  const a = state.approvals.find((x) => x.id === id);
  if (!a) throw new DecisionError("No such approval");
  if (a.status !== "pending") throw new DecisionError("This has already been decided");
  if (decision === "approved" && a.requiresVerification && (note ?? "").trim().length < 20) {
    throw new DecisionError(`Record how this was verified first: ${a.requiresVerification}`);
  }
  a.status = decision;
  a.decidedBy = actor;
  a.decidedAt = state.now();
  if (note?.trim()) a.note = note.trim();
  state.audit.push({ at: a.decidedAt, actor, clientKey: a.clientKey, action: `approval.${decision}`, refs: [a.id, ...a.refs], ...(a.note ? { detail: a.note } : {}) });
  return a;
}

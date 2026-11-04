// Builds each client's organisational obligations calendar from three sources:
// the rules engine (what applies as the business grows), HMRC obligations
// (returns falling due) and Companies House (accounts and confirmation
// statements). Every task has a stable key, so re-running never duplicates.

import {
  addMonthsToMonth,
  evaluateEntity,
  lastDayOfMonth,
  monthOf,
  monthsBetweenInclusive,
  type ISODate,
  type Mode,
  type ParameterFile,
  type Rule,
  type RuleState,
  type TaskDraft,
  type Transition,
} from "@geartrain/rules-engine";
import type { CompanyRegistry, TaxAuthority, TaxObligation } from "@geartrain/connectors";
import type { ClientDataset } from "@geartrain/synthetic";
import { DEFAULT_ANSWERS, entityContext, type OnboardingAnswers } from "./context.ts";

/** The nine pilot processes, as named in the pilot process build specs. */
export const PILOT_PROCESSES = [
  "obligationsCalendar",
  "bookkeepingClose",
  "supplierBills",
  "invoicing",
  "creditControl",
  "vatReturn",
  "selfAssessment",
  "hmrcLetters",
  "companySecretarial",
] as const;
export type ProcessKey = (typeof PILOT_PROCESSES)[number] | "corporationTax" | "payroll";

export interface CalendarTask {
  /** Idempotency key: entity, source, rule or regime, obligation, kind and period. */
  key: string;
  entityKey: string;
  source: "rulesEngine" | "hmrc" | "companiesHouse";
  kind: TaskDraft["kind"] | "filing";
  audience: "client" | "internal";
  title: string;
  mode: Mode;
  processKey?: ProcessKey | string;
  deadline?: ISODate;
  status: "open" | "done";
  completedOn?: ISODate;
  overdue: boolean;
  raisedOn: ISODate;
  ruleId?: string;
  ruleVersion?: number;
  obligationId?: string;
  periodKey: string;
  note?: string;
  /** For an authority's filing that a rule also requires: the rule obligation it fulfils. */
  basis?: { ruleId: string; obligationId: string };
}

export interface EngineRun {
  tasks: CalendarTask[];
  states: Record<string, RuleState>;
  transitions: { asOf: ISODate; ruleId: string; transition: Transition }[];
}

/** Month ends from `from` up to `to`, then `to` itself. */
export function evaluationDates(from: ISODate, to: ISODate): ISODate[] {
  const dates = monthsBetweenInclusive(monthOf(from), addMonthsToMonth(monthOf(to), -1))
    .map((m) => lastDayOfMonth(`${m}-01`))
    .filter((d) => d >= from && d < to);
  return [from, ...dates.filter((d) => d !== from), to].filter((d, i, a) => a.indexOf(d) === i);
}

export function runEngine(
  d: ClientDataset,
  rules: Rule[],
  params: ParameterFile,
  dates: ISODate[],
  previous: Record<string, RuleState> = {},
  answers: OnboardingAnswers = DEFAULT_ANSWERS,
): EngineRun {
  const states = { ...previous };
  const tasks = new Map<string, CalendarTask>();
  const transitions: EngineRun["transitions"] = [];
  for (const asOf of dates) {
    const { ctx, derivedForRule, anchors, triggerDates } = entityContext(d, asOf, params, answers);
    const result = evaluateEntity({ rules, asOf, ctx, anchors, previous: states, triggerDates, derivedForRule });
    for (const ev of result.evaluations) {
      states[ev.ruleId] = ev.state;
      if (ev.transition !== "unchanged") transitions.push({ asOf, ruleId: ev.ruleId, transition: ev.transition });
      for (const t of ev.tasks) add(tasks, fromDraft(d.profile.key, t, asOf));
    }
    for (const n of result.notices) add(tasks, fromDraft(d.profile.key, n, asOf));
  }
  return { tasks: [...tasks.values()], states, transitions };
}

function add(map: Map<string, CalendarTask>, t: CalendarTask) {
  if (!map.has(t.key)) map.set(t.key, t);
}

function fromDraft(entityKey: string, t: TaskDraft, raisedOn: ISODate): CalendarTask {
  return {
    key: [entityKey, "rulesEngine", t.ruleId, t.obligationId ?? "-", t.kind, t.periodKey].join("|"),
    entityKey,
    source: "rulesEngine",
    kind: t.kind,
    audience: t.audience,
    title: t.title,
    mode: t.mode,
    ...(t.processKey ? { processKey: t.processKey } : {}),
    ...(t.deadline ? { deadline: t.deadline } : {}),
    status: "open",
    overdue: t.overdue,
    raisedOn,
    ruleId: t.ruleId,
    ruleVersion: t.ruleVersion,
    ...(t.obligationId ? { obligationId: t.obligationId } : {}),
    periodKey: t.periodKey,
    ...(t.note ? { note: t.note } : {}),
  };
}

const REGIME_TASK: Record<TaxObligation["regime"], { title: (o: TaxObligation) => string; processKey: ProcessKey; mode: Mode }> = {
  vat: { title: (o) => `VAT return for ${o.start} to ${o.end}`, processKey: "vatReturn", mode: "signoff" },
  itsaQuarterly: { title: (o) => `MTD quarterly update for ${o.start} to ${o.end}`, processKey: "selfAssessment", mode: "signoff" },
  selfAssessment: { title: (o) => `Self Assessment return for ${o.start.slice(0, 4)}-${o.end.slice(2, 4)}`, processKey: "selfAssessment", mode: "signoff" },
  corporationTax: { title: (o) => `Corporation Tax return (CT600) for the period to ${o.end}`, processKey: "corporationTax", mode: "signoff" },
  paye: { title: (o) => `PAYE for the tax month to ${o.end}`, processKey: "payroll", mode: "interplay" },
};

/** Open HMRC obligations, plus those fulfilled in the past year for the track record. */
export async function hmrcTasks(entityKey: string, hmrc: TaxAuthority, asOf: ISODate): Promise<CalendarTask[]> {
  const yearAgo = `${Number(asOf.slice(0, 4)) - 1}${asOf.slice(4)}`;
  const obligations = await hmrc.obligations({ from: yearAgo });
  return obligations.map((o) => {
    const spec = REGIME_TASK[o.regime];
    return {
      key: [entityKey, "hmrc", o.regime, o.periodKey].join("|"),
      entityKey,
      source: "hmrc",
      kind: "filing",
      audience: "client",
      title: spec.title(o),
      mode: spec.mode,
      processKey: spec.processKey,
      deadline: o.due,
      status: o.status === "F" ? "done" : "open",
      ...(o.received ? { completedOn: o.received } : {}),
      overdue: o.status === "O" && o.due < asOf,
      raisedOn: o.start,
      periodKey: o.periodKey,
    };
  });
}

export async function companiesHouseTasks(d: ClientDataset, ch: CompanyRegistry, asOf: ISODate): Promise<CalendarTask[]> {
  const number = d.profile.entity.companyNumber;
  if (!number) return [];
  const p = await ch.profile(number);
  if (!p) return [];
  const base = { entityKey: d.profile.key, source: "companiesHouse" as const, kind: "filing" as const, audience: "client" as const, processKey: "companySecretarial", status: "open" as const };
  return [
    {
      ...base,
      key: [d.profile.key, "companiesHouse", "accounts", p.accounts.nextMadeUpTo].join("|"),
      title: `File annual accounts made up to ${p.accounts.nextMadeUpTo} at Companies House`,
      mode: "signoff",
      deadline: p.accounts.nextDue,
      overdue: p.accounts.overdue,
      raisedOn: asOf,
      periodKey: p.accounts.nextMadeUpTo,
    },
    {
      ...base,
      key: [d.profile.key, "companiesHouse", "confirmationStatement", p.confirmationStatement.nextMadeUpTo].join("|"),
      title: `Confirmation statement made up to ${p.confirmationStatement.nextMadeUpTo}`,
      mode: "signoff",
      deadline: p.confirmationStatement.nextDue,
      overdue: p.confirmationStatement.overdue,
      raisedOn: asOf,
      periodKey: p.confirmationStatement.nextMadeUpTo,
    },
  ];
}

export interface BuildOptions {
  rules: Rule[];
  params: ParameterFile;
  /** When Geartrain took the client on; the engine replays month by month from here. */
  onboardedOn: ISODate;
  asOf: ISODate;
  hmrc: TaxAuthority;
  companiesHouse: CompanyRegistry;
  answers?: OnboardingAnswers;
}

export interface Calendar {
  entityKey: string;
  asOf: ISODate;
  tasks: CalendarTask[];
  engine: Omit<EngineRun, "tasks">;
}

/**
 * Rule obligations whose dates the authority itself publishes. When the
 * authority feed has the filing, its dates win and the rule's generic task is
 * dropped, so the client sees one task, not two.
 */
const FULFILLED_BY_AUTHORITY: { ruleId: string; obligationId: string; matches: (t: CalendarTask) => boolean }[] = [
  { ruleId: "companies-house-core", obligationId: "annual-accounts-within-9-months", matches: (t) => t.source === "companiesHouse" && t.key.includes("|accounts|") },
  { ruleId: "companies-house-core", obligationId: "confirmation-statement-every-12-months", matches: (t) => t.source === "companiesHouse" && t.key.includes("|confirmationStatement|") },
  { ruleId: "mtd-itsa-2026", obligationId: "four-quarterly-updates", matches: (t) => t.source === "hmrc" && t.key.includes("|itsaQuarterly|") },
];

export async function buildCalendar(d: ClientDataset, o: BuildOptions): Promise<Calendar> {
  const run = runEngine(d, o.rules, o.params, evaluationDates(o.onboardedOn, o.asOf), {}, o.answers);
  const authority = [...(await hmrcTasks(d.profile.key, o.hmrc, o.asOf)), ...(await companiesHouseTasks(d, o.companiesHouse, o.asOf))];
  const engineTasks = run.tasks.filter((t) => {
    const link = FULFILLED_BY_AUTHORITY.find((f) => f.ruleId === t.ruleId && f.obligationId === t.obligationId && t.kind === "obligation");
    const covering = link ? authority.filter(link.matches) : [];
    for (const a of covering) a.basis = { ruleId: link!.ruleId, obligationId: link!.obligationId };
    return covering.length === 0;
  });
  const tasks = [...engineTasks, ...authority];
  for (const t of tasks) t.overdue = t.status === "open" && t.deadline !== undefined && t.deadline < o.asOf;
  tasks.sort((a, b) => (a.deadline ?? "9999") .localeCompare(b.deadline ?? "9999") || a.key.localeCompare(b.key));
  return { entityKey: d.profile.key, asOf: o.asOf, tasks, engine: { states: run.states, transitions: run.transitions } };
}

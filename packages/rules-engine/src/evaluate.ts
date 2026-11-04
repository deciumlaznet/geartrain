// Evaluates rules for one legal entity on one date and turns changes into
// work. Only transitions create work; a rule that keeps applying creates
// nothing new.

import { evaluateCondition, MissingValueError, type Context, type Trace } from "./conditions.ts";
import { computeDeadline, MissingAnchorError, type Anchors } from "./deadlines.ts";
import { inForceOn, upcoming } from "./versions.ts";
import type { ISODate, Mode, Obligation, Rule } from "./types.ts";

export type Transition = "entered" | "exited" | "approaching" | "versionChanged" | "unchanged" | "needsFact";

/** What the engine remembers per entity and rule between runs. */
export interface RuleState {
  applies: boolean;
  version: number | null;
  /** Consecutive evaluations the condition has been false while the rule still applied. */
  falseStreak: number;
  warned: boolean;
  triggerDate?: ISODate;
}

export const NOT_APPLYING: RuleState = { applies: false, version: null, falseStreak: 0, warned: false };

export type TaskKind = "obligation" | "exit" | "earlyWarning" | "expertReview" | "missingFact" | "notice";

export interface TaskDraft {
  kind: TaskKind;
  /** Client-facing work, or internal work for the expert partner only. */
  audience: "client" | "internal";
  ruleId: string;
  ruleVersion: number;
  obligationId?: string;
  title: string;
  mode: Mode;
  deadline?: ISODate;
  /** With entity, rule and obligation, the idempotency key: re-runs never duplicate a task. */
  periodKey: string;
  processKey?: string;
  overdue: boolean;
  note?: string;
}

export interface RuleEvaluation {
  ruleId: string;
  ruleVersion: number;
  asOf: ISODate;
  result: boolean | "unknown";
  transition: Transition;
  trace: Trace;
  state: RuleState;
  tasks: TaskDraft[];
}

export interface EvaluateInput {
  rules: Rule[];
  asOf: ISODate;
  ctx: Context;
  anchors: Anchors;
  previous: Record<string, RuleState>;
  /** The date each condition first became true, when known (e.g. the VAT month end). */
  triggerDates?: Record<string, ISODate>;
  /** Per-rule overrides for derived values that depend on the rule's basis (headcount, size). */
  derivedForRule?: (rule: Rule) => Record<string, unknown>;
}

export interface EntityEvaluation {
  evaluations: RuleEvaluation[];
  notices: TaskDraft[];
}

function obligationTasks(
  rule: Rule,
  obligations: Obligation[],
  kind: "obligation" | "exit",
  triggerDate: ISODate,
  asOf: ISODate,
  anchors: Anchors,
  ctx: Context,
  periodKeyOverride?: string,
): TaskDraft[] {
  if (!rule.verified) {
    return [
      {
        kind: "expertReview",
        audience: "internal",
        ruleId: rule.id,
        ruleVersion: rule.version,
        title: `Verify "${rule.title}" before it creates client work`,
        mode: "human",
        periodKey: periodKeyOverride ?? `${kind}:${triggerDate}`,
        overdue: false,
        note: `Rule ${kind === "exit" ? "stopped applying" : "applies"} from ${triggerDate} but is unverified.`,
      },
    ];
  }
  return obligations.map((o) => {
    const allAnchors: Anchors = { triggerDate, ...anchors };
    let deadline: ISODate | undefined;
    let note: string | undefined;
    try {
      deadline = computeDeadline(o.deadline, allAnchors, ctx);
    } catch (e) {
      if (!(e instanceof MissingAnchorError)) throw e;
      note = `Deadline needs ${e.anchor}`;
    }
    const recurring = o.recurrence.every !== "once";
    return {
      kind,
      audience: "client",
      ruleId: rule.id,
      ruleVersion: rule.version,
      obligationId: o.id,
      title: o.title,
      mode: o.mode ?? rule.mode,
      ...(o.processKey ? { processKey: o.processKey } : {}),
      ...(deadline ? { deadline } : {}),
      periodKey: periodKeyOverride ?? (recurring ? (anchors.periodEnd ?? deadline ?? triggerDate) : triggerDate),
      overdue: deadline !== undefined && deadline < asOf,
      ...(note ? { note } : {}),
    };
  });
}

export function evaluateRule(
  rule: Rule,
  input: Omit<EvaluateInput, "rules">,
): RuleEvaluation {
  const prev = input.previous[rule.id] ?? NOT_APPLYING;
  const ctx: Context = input.derivedForRule
    ? { ...input.ctx, derived: { ...input.ctx.derived, ...input.derivedForRule(rule) } }
    : input.ctx;
  const trace: Trace = {};
  const base = { ruleId: rule.id, ruleVersion: rule.version, asOf: input.asOf, trace };

  let result: boolean;
  try {
    result = evaluateCondition(rule.when ?? "always", ctx, trace);
  } catch (e) {
    if (!(e instanceof MissingValueError)) throw e;
    return {
      ...base,
      result: "unknown",
      transition: "needsFact",
      state: prev,
      tasks: [
        {
          kind: "missingFact",
          audience: "internal",
          ruleId: rule.id,
          ruleVersion: rule.version,
          title: `Find ${e.path} to test "${rule.title}"`,
          mode: "human",
          periodKey: `missing:${e.path}`,
          overdue: false,
        },
      ],
    };
  }

  if (result) {
    if (!prev.applies) {
      const triggerDate = input.triggerDates?.[rule.id] ?? input.asOf;
      return {
        ...base,
        result,
        transition: "entered",
        state: { applies: true, version: rule.version, falseStreak: 0, warned: prev.warned, triggerDate },
        tasks: obligationTasks(rule, rule.obligations, "obligation", triggerDate, input.asOf, input.anchors, ctx),
      };
    }
    const state: RuleState = { ...prev, falseStreak: 0, version: rule.version };
    return { ...base, result, transition: prev.version === rule.version ? "unchanged" : "versionChanged", state, tasks: [] };
  }

  if (prev.applies) {
    const streak = prev.falseStreak + 1;
    if (streak >= Math.max(1, rule.exitAfter ?? 0)) {
      return {
        ...base,
        result,
        transition: "exited",
        state: { ...NOT_APPLYING },
        tasks: obligationTasks(rule, rule.onExit ?? [], "exit", input.asOf, input.asOf, input.anchors, ctx),
      };
    }
    // Hysteresis: still applies until the condition has been false long enough.
    return { ...base, result, transition: "unchanged", state: { ...prev, falseStreak: streak }, tasks: [] };
  }

  if (rule.warn && !prev.warned) {
    let warned = false;
    try {
      warned = evaluateCondition(rule.warn.when, ctx, trace);
    } catch (e) {
      if (!(e instanceof MissingValueError)) throw e;
    }
    if (warned) {
      return {
        ...base,
        result,
        transition: "approaching",
        state: { ...prev, warned: true },
        tasks: [
          {
            kind: "earlyWarning",
            audience: rule.verified ? "client" : "internal",
            ruleId: rule.id,
            ruleVersion: rule.version,
            title: `Approaching: ${rule.title}`,
            mode: rule.mode,
            periodKey: `warn:${input.asOf}`,
            overdue: false,
          },
        ],
      };
    }
  }
  return { ...base, result, transition: "unchanged", state: prev, tasks: [] };
}

export function evaluateEntity(input: EvaluateInput): EntityEvaluation {
  const thresholdRules = inForceOn(input.rules, input.asOf).filter((r) => (r.trigger ?? "threshold") === "threshold");
  const evaluations = thresholdRules.map((rule) => evaluateRule(rule, input));
  const notices: TaskDraft[] = upcoming(input.rules, input.asOf).map((r) => ({
    kind: "notice",
    audience: r.verified ? "client" : "internal",
    ruleId: r.id,
    ruleVersion: r.version,
    title: `Coming ${r.effectiveFrom} (${r.status}): ${r.title}`,
    mode: r.mode,
    periodKey: `notice:${r.effectiveFrom}`,
    overdue: false,
  }));
  return { evaluations, notices };
}

// ---- Event rules -------------------------------------------------------------

export interface EntityEvent {
  eventId: string;
  type: string;
  occurredOn: ISODate;
  sourceRef: string;
  /** Events an agent spotted in email or documents fire nothing until the client confirms. */
  confirmed: boolean;
  payload: Record<string, unknown>;
}

export function evaluateEvent(rules: Rule[], ev: EntityEvent, asOf: ISODate, ctx: Context, anchors: Anchors = {}): TaskDraft[] {
  if (!ev.confirmed) return [];
  const eventCtx: Context = { ...ctx, payload: ev.payload };
  return inForceOn(rules, ev.occurredOn)
    .filter((r) => r.trigger === "event" && r.event?.type === ev.type)
    .filter((r) => {
      try {
        return evaluateCondition(r.event?.where ?? "always", eventCtx);
      } catch (e) {
        if (e instanceof MissingValueError) return false;
        throw e;
      }
    })
    .flatMap((r) => obligationTasks(r, r.obligations, "obligation", ev.occurredOn, asOf, anchors, eventCtx, ev.sourceRef));
}

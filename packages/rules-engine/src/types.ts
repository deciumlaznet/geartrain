// Shapes of the rule file. The JSON Schema in rules/rule.schema.json is the
// source of truth; these types mirror it for use in code.

export type ISODate = string; // YYYY-MM-DD, a calendar date in Europe/London
export type Month = string; // YYYY-MM

export type Mode = "agent" | "signoff" | "interplay" | "human";
export type RuleStatus = "consulted" | "announced" | "enacted" | "inForce" | "repealed";
export type CompanySize = "micro" | "small" | "medium" | "large";

export type Op = "gte" | "gt" | "lt" | "lte" | "eq" | "in" | "has" | "sizeAtLeast";

export interface Test {
  field: string;
  op: Op;
  value?: unknown;
}

export type Condition =
  | "always"
  | Test
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export type Anchor =
  | "triggerDate"
  | "periodStart"
  | "periodEnd"
  | "financialYearEnd"
  | "incorporationDate"
  | "taxYearEnd"
  | "taxMonthEnd"
  | "payday"
  | "snapshotDate"
  | "fixed";

export interface Offset {
  months?: number;
  days?: number;
}

export interface Deadline {
  anchor: Anchor;
  fixed?: string; // MM-DD
  payloadField?: string;
  offset: Offset;
  adjust?: "none" | "previousWorkingDay" | "nextWorkingDay";
}

export type RecurrenceUnit =
  | "once"
  | "monthly"
  | "taxMonth"
  | "quarterly"
  | "annual"
  | "accountingPeriod"
  | "financialYear";

export interface Obligation {
  id: string;
  title: string;
  recurrence: { every: RecurrenceUnit; interval?: number };
  deadline: Deadline;
  remindDaysBefore?: number[];
  mode?: Mode;
  evidence?: string[];
  penalty?: { type?: string; text?: string };
}

export interface Rule {
  id: string;
  version: number;
  pack: string;
  factor: string;
  title: string;
  module: string;
  phase: number;
  status: RuleStatus;
  mode: Mode;
  trigger?: "threshold" | "event";
  when?: Condition;
  event?: { type: string; where?: Condition };
  warn?: { when: Condition; project?: { series: string; threshold: number } } | null;
  exitAfter?: number | null;
  headcountBasis?: HeadcountBasis | null;
  sizeBasis?: "entity" | "group" | "connected" | null;
  obligations: Obligation[];
  onExit?: Obligation[];
  effectiveFrom: ISODate;
  effectiveTo?: ISODate | null;
  legalRef?: string;
  sourceUrl?: string;
  verified: boolean;
  penalty?: { amountPence?: number; text: string; basis: "fixed" | "estimate" | "unlimited" };
  reviewBy?: ISODate;
  note?: string;
}

export interface RuleFile {
  name: string;
  version: string;
  asOf: ISODate;
  status?: string;
  rules: Rule[];
}

export type HeadcountBasis =
  | "presentNow"
  | "averageFY"
  | "average12Months"
  | "onDay"
  | "perWorker"
  | "proposedDismissals90Days";

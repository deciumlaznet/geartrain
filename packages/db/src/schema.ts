// Postgres schema for Geartrain. Postgres is the system of record; Smartsheet
// mirrors work items for people to see and sign off.
//
// Conventions: money in integer pence (bigint), calendar dates as `date`,
// months as YYYY-MM text, every client-owned row carries client_id so
// row-level security (migrations/0001_rls.sql) can keep clients apart.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const legalForm = pgEnum("legal_form", ["soleTrader", "partnership", "llp", "ltd", "plc", "charity", "cic"]);
export const ruleStatus = pgEnum("rule_status", ["consulted", "announced", "enacted", "inForce", "repealed"]);
export const mode = pgEnum("mode", ["agent", "signoff", "interplay", "human"]);
export const userRole = pgEnum("user_role", ["clientOwner", "clientStaff", "expert", "operator"]);
export const taskState = pgEnum("task_state", ["open", "inProgress", "awaitingApproval", "done", "cancelled"]);
export const audience = pgEnum("audience", ["client", "internal"]);

// ---- Clients, entities, people ------------------------------------------------

export const clients = pgTable("clients", {
  id: id(),
  name: text("name").notNull(),
  sizeBand: text("size_band"),
  enabledModules: text("enabled_modules").array().notNull().default(sql`'{}'`),
  smartsheetWorkspaceId: text("smartsheet_workspace_id"),
  /** Client configuration from the pilot process specs (B3): tone, chase cadence, sign-off contacts. */
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
});

export const legalEntities = pgTable(
  "legal_entities",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    name: text("name").notNull(),
    /** Current legal form; the dated history lives in facts (field legalForm). */
    legalForm: legalForm("legal_form").notNull(),
    companyNumber: text("company_number"),
    vatNumber: text("vat_number"),
    payeReference: text("paye_reference"),
    currency: text("currency").notNull().default("GBP"),
    createdAt: createdAt(),
  },
  (t) => [index("legal_entities_client_idx").on(t.clientId)],
);

export const users = pgTable("users", {
  id: id(),
  clientId: uuid("client_id").references(() => clients.id), // null for Geartrain staff and experts
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRole("role").notNull(),
  createdAt: createdAt(),
});

// ---- Facts the rules engine reads (bitemporal: applies_from + recorded_at) -----

/** Dated facts: legal form, nations, sectors, activities, VAT registration, parent, control. */
export const facts = pgTable(
  "facts",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    entityId: uuid("entity_id").notNull().references(() => legalEntities.id),
    field: text("field").notNull(),
    value: jsonb("value").notNull(),
    appliesFrom: date("applies_from").notNull(),
    source: text("source").notNull(), // xero, payroll, onboarding, estimate, adviser
    sourceRef: text("source_ref"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("facts_lookup_idx").on(t.entityId, t.field, t.appliesFrom, t.recordedAt)],
);

/** Monthly series: taxableTurnover, turnover, headcountMonth, headcountEndOfMonth, payBillClass1. */
export const seriesPoints = pgTable(
  "series_points",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    entityId: uuid("entity_id").notNull().references(() => legalEntities.id),
    series: text("series").notNull(),
    month: text("month").notNull(), // YYYY-MM
    value: bigint("value", { mode: "number" }).notNull(),
    source: text("source").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("series_lookup_idx").on(t.entityId, t.series, t.month, t.recordedAt)],
);

export const events = pgTable(
  "events",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    entityId: uuid("entity_id").notNull().references(() => legalEntities.id),
    type: text("type").notNull(),
    occurredOn: date("occurred_on").notNull(),
    payload: jsonb("payload").notNull(),
    source: text("source").notNull(),
    sourceRef: text("source_ref").notNull(),
    confirmed: boolean("confirmed").notNull().default(false),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("events_source_ref_uq").on(t.entityId, t.sourceRef)],
);

// ---- Rules (shared across clients, no client_id) --------------------------------

export const rules = pgTable("rules", {
  id: text("id").primaryKey(),
  pack: text("pack").notNull(),
  factor: text("factor").notNull(),
  title: text("title").notNull(),
  createdAt: createdAt(),
});

/** Immutable once published; a change is a new row. */
export const ruleVersions = pgTable(
  "rule_versions",
  {
    ruleId: text("rule_id").notNull().references(() => rules.id),
    version: integer("version").notNull(),
    status: ruleStatus("status").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    body: jsonb("body").notNull(), // the rule object exactly as published
    verified: boolean("verified").notNull(),
    sourceUrl: text("source_url"),
    approvedBy: uuid("approved_by").array().notNull().default(sql`'{}'`),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    reviewBy: date("review_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.version] })],
);

export const ruleChanges = pgTable("rule_changes", {
  id: id(),
  ruleId: text("rule_id").notNull(),
  proposedVersion: jsonb("proposed_version").notNull(),
  diff: jsonb("diff"),
  source: text("source"),
  raisedBy: text("raised_by").notNull(), // agent id or user id
  state: text("state").notNull(), // watch, draft, review, test, impact, publish, record
  createdAt: createdAt(),
});

// ---- Engine output ---------------------------------------------------------------

/** Append-only. One row per entity, rule and run only when result, transition or version changes. */
export const evaluations = pgTable(
  "evaluations",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    entityId: uuid("entity_id").notNull().references(() => legalEntities.id),
    ruleId: text("rule_id").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    asOf: date("as_of").notNull(),
    result: text("result").notNull(), // true, false, unknown
    transition: text("transition").notNull(),
    trace: jsonb("trace").notNull(),
    runId: uuid("run_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("evaluations_entity_rule_idx").on(t.entityId, t.ruleId, t.asOf)],
);

/** Latest engine state per entity and rule (hysteresis counters, trigger date). */
export const ruleStates = pgTable(
  "rule_states",
  {
    clientId: uuid("client_id").notNull().references(() => clients.id),
    entityId: uuid("entity_id").notNull().references(() => legalEntities.id),
    ruleId: text("rule_id").notNull(),
    applies: boolean("applies").notNull(),
    version: integer("version"),
    falseStreak: integer("false_streak").notNull().default(0),
    warned: boolean("warned").notNull().default(false),
    triggerDate: date("trigger_date"),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.ruleId] })],
);

/** The organisational obligations calendar. Mirrored to Smartsheet by smartsheet_row_id. */
export const obligationTasks = pgTable(
  "obligation_tasks",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    entityId: uuid("entity_id").notNull().references(() => legalEntities.id),
    ruleId: text("rule_id").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    obligationId: text("obligation_id").notNull().default(""),
    kind: text("kind").notNull(),
    audience: audience("audience").notNull(),
    periodKey: text("period_key").notNull(),
    title: text("title").notNull(),
    mode: mode("mode").notNull(),
    triggerDate: date("trigger_date"),
    deadline: date("deadline"),
    state: taskState("state").notNull().default("open"),
    evidence: jsonb("evidence"),
    /** The pilot process that discharges this task (e.g. vatReturn, selfAssessment). */
    processKey: text("process_key"),
    smartsheetRowId: text("smartsheet_row_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("obligation_tasks_idempotency_uq").on(t.entityId, t.ruleId, t.obligationId, t.kind, t.periodKey),
    index("obligation_tasks_calendar_idx").on(t.clientId, t.deadline),
  ],
);

// ---- Bookkeeping configuration and evidence --------------------------------------

/** How a payee or bank description is coded in the ledger. Proposed by agents, approved by people. */
export const codingRules = pgTable(
  "coding_rules",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    entityId: uuid("entity_id").notNull().references(() => legalEntities.id),
    matchField: text("match_field").notNull(), // payee, description, reference
    matchPattern: text("match_pattern").notNull(),
    accountCode: text("account_code").notNull(),
    taxType: text("tax_type"),
    proposedBy: text("proposed_by").notNull(),
    approvedBy: uuid("approved_by").references(() => users.id),
    active: boolean("active").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("coding_rules_entity_idx").on(t.entityId, t.active)],
);

/** Maps an entity's ledger accounts to HMRC categories (Self Assessment boxes, MTD categories, VAT boxes). */
export const taxCategoryMaps = pgTable(
  "tax_category_maps",
  {
    clientId: uuid("client_id").notNull().references(() => clients.id),
    entityId: uuid("entity_id").notNull().references(() => legalEntities.id),
    accountCode: text("account_code").notNull(),
    scheme: text("scheme").notNull(), // selfAssessment, mtdIncomeTax, vat
    category: text("category").notNull(),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.accountCode, t.scheme] })],
);

/** Closes every task: what was used, what changed in Xero, who approved, kept for the retention period. */
export const taskEvidence = pgTable("task_evidence", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => clients.id),
  taskId: uuid("task_id").notNull().references(() => obligationTasks.id),
  inputs: jsonb("inputs").notNull(),
  ledgerObjectIds: text("ledger_object_ids").array().notNull().default(sql`'{}'`),
  documents: text("documents").array().notNull().default(sql`'{}'`),
  approverId: uuid("approver_id").references(() => users.id),
  exceptionNote: text("exception_note"),
  retainUntil: date("retain_until").notNull(),
  createdAt: createdAt(),
});

// ---- Approvals and audit ---------------------------------------------------------

export const approvalPolicies = pgTable("approval_policies", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => clients.id),
  entityId: uuid("entity_id").references(() => legalEntities.id),
  domain: text("domain").notNull(),
  maxAmountPence: bigint("max_amount_pence", { mode: "number" }),
  approverRole: userRole("approver_role").notNull(),
});

export const approvals = pgTable("approvals", {
  id: id(),
  clientId: uuid("client_id").notNull().references(() => clients.id),
  taskId: uuid("task_id").references(() => obligationTasks.id),
  proposedAction: jsonb("proposed_action").notNull(),
  riskLevel: text("risk_level").notNull(), // read, reversible, external, blocked
  policyId: uuid("policy_id").references(() => approvalPolicies.id),
  reviewerId: uuid("reviewer_id").references(() => users.id),
  decision: text("decision"), // approved, rejected
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Append-only record of every agent action. Updates and deletes are revoked in 0001_rls.sql. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    entityId: uuid("entity_id").references(() => legalEntities.id),
    actor: text("actor").notNull(), // agent name or user id
    tool: text("tool"),
    inputs: jsonb("inputs"),
    output: jsonb("output"),
    outcome: text("outcome").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_client_time_idx").on(t.clientId, t.createdAt)],
);

export const bankHolidays = pgTable(
  "bank_holidays",
  {
    division: text("division").notNull(), // england-and-wales, scotland, northern-ireland (GOV.UK feed names)
    day: date("day").notNull(),
    title: text("title").notNull(),
  },
  (t) => [primaryKey({ columns: [t.division, t.day] })],
);

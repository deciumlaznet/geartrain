CREATE TYPE "public"."audience" AS ENUM('client', 'internal');--> statement-breakpoint
CREATE TYPE "public"."legal_form" AS ENUM('soleTrader', 'partnership', 'llp', 'ltd', 'plc', 'charity', 'cic');--> statement-breakpoint
CREATE TYPE "public"."mode" AS ENUM('agent', 'signoff', 'interplay', 'human');--> statement-breakpoint
CREATE TYPE "public"."rule_status" AS ENUM('consulted', 'announced', 'enacted', 'inForce', 'repealed');--> statement-breakpoint
CREATE TYPE "public"."task_state" AS ENUM('open', 'inProgress', 'awaitingApproval', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('clientOwner', 'clientStaff', 'expert', 'operator');--> statement-breakpoint
CREATE TABLE "approval_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"entity_id" uuid,
	"domain" text NOT NULL,
	"max_amount_pence" bigint,
	"approver_role" "user_role" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"task_id" uuid,
	"proposed_action" jsonb NOT NULL,
	"risk_level" text NOT NULL,
	"policy_id" uuid,
	"reviewer_id" uuid,
	"decision" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"entity_id" uuid,
	"actor" text NOT NULL,
	"tool" text,
	"inputs" jsonb,
	"output" jsonb,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_holidays" (
	"division" text NOT NULL,
	"day" date NOT NULL,
	"title" text NOT NULL,
	CONSTRAINT "bank_holidays_division_day_pk" PRIMARY KEY("division","day")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"size_band" text,
	"enabled_modules" text[] DEFAULT '{}' NOT NULL,
	"smartsheet_workspace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"as_of" date NOT NULL,
	"result" text NOT NULL,
	"transition" text NOT NULL,
	"trace" jsonb NOT NULL,
	"run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" text NOT NULL,
	"occurred_on" date NOT NULL,
	"payload" jsonb NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"applies_from" date NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"company_number" text,
	"vat_number" text,
	"paye_reference" text,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"obligation_id" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"audience" "audience" NOT NULL,
	"period_key" text NOT NULL,
	"title" text NOT NULL,
	"mode" "mode" NOT NULL,
	"trigger_date" date,
	"deadline" date,
	"state" "task_state" DEFAULT 'open' NOT NULL,
	"evidence" jsonb,
	"smartsheet_row_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" text NOT NULL,
	"proposed_version" jsonb NOT NULL,
	"diff" jsonb,
	"source" text,
	"raised_by" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_states" (
	"client_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"applies" boolean NOT NULL,
	"version" integer,
	"false_streak" integer DEFAULT 0 NOT NULL,
	"warned" boolean DEFAULT false NOT NULL,
	"trigger_date" date,
	CONSTRAINT "rule_states_entity_id_rule_id_pk" PRIMARY KEY("entity_id","rule_id")
);
--> statement-breakpoint
CREATE TABLE "rule_versions" (
	"rule_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" "rule_status" NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"body" jsonb NOT NULL,
	"verified" boolean NOT NULL,
	"source_url" text,
	"approved_by" uuid[] DEFAULT '{}' NOT NULL,
	"approved_at" timestamp with time zone,
	"review_by" date,
	"published_at" timestamp with time zone,
	CONSTRAINT "rule_versions_rule_id_version_pk" PRIMARY KEY("rule_id","version")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" text PRIMARY KEY NOT NULL,
	"pack" text NOT NULL,
	"factor" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"series" text NOT NULL,
	"month" text NOT NULL,
	"value" bigint NOT NULL,
	"source" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_obligation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."obligation_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_policy_id_approval_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."approval_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_tasks" ADD CONSTRAINT "obligation_tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_tasks" ADD CONSTRAINT "obligation_tasks_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_states" ADD CONSTRAINT "rule_states_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_states" ADD CONSTRAINT "rule_states_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_points" ADD CONSTRAINT "series_points_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_points" ADD CONSTRAINT "series_points_entity_id_legal_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_client_time_idx" ON "audit_events" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "evaluations_entity_rule_idx" ON "evaluations" USING btree ("entity_id","rule_id","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_ref_uq" ON "events" USING btree ("entity_id","source_ref");--> statement-breakpoint
CREATE INDEX "facts_lookup_idx" ON "facts" USING btree ("entity_id","field","applies_from","recorded_at");--> statement-breakpoint
CREATE INDEX "legal_entities_client_idx" ON "legal_entities" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "obligation_tasks_idempotency_uq" ON "obligation_tasks" USING btree ("entity_id","rule_id","obligation_id","kind","period_key");--> statement-breakpoint
CREATE INDEX "obligation_tasks_calendar_idx" ON "obligation_tasks" USING btree ("client_id","deadline");--> statement-breakpoint
CREATE INDEX "series_lookup_idx" ON "series_points" USING btree ("entity_id","series","month","recorded_at");
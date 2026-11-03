# Geartrain

An agentic back office for UK small and medium businesses, run as a managed
service. Agents do the drafting, matching, chasing and tracking; client owners
approve anything that moves money or reaches someone new, and qualified experts
review the judgement calls.

- Architecture: [Geartrain engineering architecture](https://claude.ai/artifact/BEMW2P7divKVA4uZKN13G6)
- Rules engine design: [Geartrain rule engine: build specification](https://claude.ai/artifact/Nhxnm9njp9teoC3PFCeR6E)

## What is here

| Path | What it is |
| --- | --- |
| `packages/rules-engine` | The engine behind the organisational obligations calendar: evaluates growth rules per legal entity, emits transitions, and turns them into dated tasks |
| `packages/rules-engine/rules/growth-rules.json` | The rule file (Research's v0.3.1, 72 rules), validated against `rule.schema.json` |
| `packages/rules-engine/rules/parameters.json` | Dated thresholds for company size, VAT, apprenticeship levy and ECCTA |
| `packages/db` | Postgres schema (Drizzle), migrations, and row-level security keeping clients apart |

Still to come: the worker that runs the engine against Xero and payroll data,
the Smartsheet sync, the Replit web app, and the agents.

## Principles the code holds to

1. **Rules are data.** No threshold, date or deadline lives in code. Code implements operators and the derived-value algorithms; numbers come from versioned rule data.
2. **Time-aware.** Every evaluation is for a stated date, so "what applied on 1 March 2026?" has an answer.
3. **Transitions, not states.** Only a change (entered, exited, approaching, version changed) creates work, and re-running never duplicates a task.
4. **Unverified rules stay internal.** A rule without expert verification creates an internal review task, never client work.
5. **Unknown is not false.** A missing fact raises a task to find it rather than silently not applying a rule.
6. **Money in pence, dates in Europe/London,** months as `YYYY-MM`.

## Getting started

Needs Node 22 and pnpm 10.

```sh
pnpm install
pnpm test            # unit tests and the 16 acceptance tests from the build spec
pnpm typecheck
pnpm validate-rules  # schema and version-overlap checks on the rule file
```

Database migrations: `packages/db/migrations` holds the generated tables
(`0000_*`) and row-level security (`0001_rls.sql`). Each request sets
`app.client_id`; the application role sees only that client's rows and can only
append to `audit_events` and `evaluations`.

## Working on this repo

Changes go through pull requests and CI must pass. Rule-file changes also need
expert approval before they are published to clients (see the build spec's
publish checks).

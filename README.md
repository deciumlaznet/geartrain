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
| `packages/connectors` | Interfaces for the ledger (Xero first), HMRC and Companies House, with in-memory stand-ins that serve the fake clients and keep the real services' limits |
| `packages/worker` | Builds each client's obligations calendar from the rules engine, HMRC obligations and Companies House dates |
| `packages/agents` | The agent loop and the first agent (document intake). Every tool has a risk class: reads and drafts run; anything that moves money waits in the approvals inbox; bank-detail changes are never done by an agent |
| `apps/web` | The demo web app: client list, obligations calendar, approvals inbox, document upload, money owed, track record, expert queue and audit trail, plus a JSON API |
| `packages/synthetic` | Three fake clients with April 2022 to October 2026 histories: ledger, bank feed, payroll, filings, letters, supplier documents and planted edge cases for red-teaming |

Still to come: database persistence for the web app, the Smartsheet sync, and agents for the other pilot processes.

Agents run only when the `ANTHROPIC_API_KEY` secret is set; without it the demo stores uploads and says agents are off.

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
pnpm install --prod=false   # include dev tools; a plain install is production-only (see .npmrc)
pnpm test            # unit tests and the 16 acceptance tests from the build spec
pnpm typecheck
pnpm validate-rules  # schema and version-overlap checks on the rule file
pnpm --filter @geartrain/synthetic generate   # writes the fake clients to data/synthetic (gitignored)
pnpm --filter @geartrain/worker calendar 2026-11-03   # prints each fake client's obligations calendar
DEMO_DATE=2026-11-03 pnpm start                        # the demo web app on http://localhost:3000 (needs the sign-in secrets)
```

On Replit, import the GitHub repo and press Run: `.replit` installs and starts the demo. Sign-in is
invite-only: set the `SESSION_SECRET` and `GEARTRAIN_USERS` secrets first (see
[apps/web/README.md](apps/web/README.md)). The demo holds everything in memory, so it
must only ever show fake clients.

### The fake clients

| Client | Shape | What its history exercises |
| --- | --- | --- |
| Fenwick Garden Design | Sole trader, seasonal, rental income, not VAT-registered | Self Assessment track record, crossing the £50k MTD for Income Tax test, an open quarterly update due 7 Nov 2026 |
| Copperleaf Studio Ltd | Scottish design studio, 2 to 4 staff | Crossing the VAT threshold and registering, a late VAT return and penalty, freelancers, bad debt, an overdrawn director's loan |
| Northgate Precision Engineering Ltd | Engineering firm growing from 3 to about 42 staff, £0.9m to £3.5m sales | Purchase orders, payroll with starters and leavers, size thresholds, duplicate bills, a bank-details-change fraud attempt, an HMRC compliance check |

Each planted edge case records what a correct agent does, so red-team tests can
check against it. The tax figures are approximations for test data only.

Database migrations: `packages/db/migrations` holds the generated tables
(`0000_*`) and row-level security (`0001_rls.sql`). Each request sets
`app.client_id`; the application role sees only that client's rows and can only
append to `audit_events` and `evaluations`.

## Working on this repo

Changes go through pull requests and CI must pass. Rule-file changes also need
expert approval before they are published to clients (see the build spec's
publish checks).

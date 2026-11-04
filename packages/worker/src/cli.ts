// Prints each fake client's obligations calendar as of a date.
// Usage: pnpm --filter @geartrain/worker calendar [asOf] [onboardedOn]
import { MockCompaniesHouse, MockHmrc } from "@geartrain/connectors";
import { loadParameters, loadRuleFile } from "@geartrain/rules-engine";
import { allPlans, generateClient } from "@geartrain/synthetic";
import { buildCalendar } from "./calendar.ts";

const asOf = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const onboardedOn = process.argv[3] ?? "2026-10-01";
const rules = loadRuleFile().rules;
const params = loadParameters();
const datasets = allPlans.map((p) => generateClient(p));
const companiesHouse = new MockCompaniesHouse(datasets, asOf);

for (const d of datasets) {
  const cal = await buildCalendar(d, { rules, params, onboardedOn, asOf, hmrc: new MockHmrc(d, asOf), companiesHouse });
  const open = cal.tasks.filter((t) => t.status === "open");
  const client = open.filter((t) => t.audience === "client");
  const internal = open.filter((t) => t.audience === "internal");
  console.log(`\n${d.profile.clientName}: ${client.length} open client tasks, ${internal.length} internal (expert review or missing facts), ${cal.tasks.length - open.length} done in the last year`);
  for (const t of client) console.log(`  ${t.deadline ?? "(no date) "} ${t.overdue ? "OVERDUE " : ""}[${t.source}] ${t.title}${t.note ? ` (${t.note})` : ""}`);
}

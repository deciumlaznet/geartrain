// Writes each fake client's dataset to data/synthetic/<key>/ (gitignored) and
// prints a summary. Usage: pnpm --filter @geartrain/synthetic generate [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { allPlans } from "./clients.ts";
import { generateClient } from "./generate.ts";

const outRoot = resolve(process.argv[2] ?? join(import.meta.dirname, "../../../data/synthetic"));

const rows: Record<string, string | number>[] = [];
for (const plan of allPlans) {
  const data = generateClient(plan);
  const dir = join(outRoot, data.profile.key);
  mkdirSync(join(dir, "documents"), { recursive: true });
  const { documents, ...rest } = data;
  for (const [name, value] of Object.entries(rest)) {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(value, null, 2) + "\n");
  }
  for (const doc of documents) writeFileSync(join(dir, "documents", doc.fileName), doc.content);
  writeFileSync(join(dir, "documents.json"), JSON.stringify(documents.map(({ content: _c, ...d }) => d), null, 2) + "\n");

  const sales = data.invoices.reduce((s, i) => s + i.netPence, 0);
  rows.push({
    client: data.profile.clientName,
    invoices: data.invoices.length,
    bills: data.bills.length,
    POs: data.purchaseOrders.length,
    bankLines: data.bankLines.length,
    staffEver: data.employees.length,
    payRuns: data.payRuns.length,
    filings: data.filings.length,
    letters: data.letters.length,
    docs: documents.length,
    edgeCases: data.edgeCases.length,
    "sales £k": Math.round(sales / 100_000),
  });
}
console.table(rows);
console.log(`Written to ${outRoot}`);

import { readFileSync } from "node:fs";
import { validateRuleFile } from "../validate.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: validate-rules <rule-file.json>");
  process.exit(2);
}
const report = validateRuleFile(JSON.parse(readFileSync(path, "utf8")));
for (const e of report.schemaErrors) console.error(`schema: ${e}`);
for (const o of report.overlaps) console.error(`overlap: ${o}`);
console.log(report.ok ? `${path}: valid` : `${path}: ${report.schemaErrors.length + report.overlaps.length} problem(s)`);
process.exit(report.ok ? 0 : 1);

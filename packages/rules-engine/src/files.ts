// The rule file and parameter file shipped with this package.
import { readFileSync } from "node:fs";
import type { ParameterFile } from "./parameters.ts";
import type { RuleFile } from "./types.ts";

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../rules/${name}`, import.meta.url), "utf8")) as T;

export const loadRuleFile = (): RuleFile => read<RuleFile>("growth-rules.json");
export const loadParameters = (): ParameterFile => read<ParameterFile>("parameters.json");

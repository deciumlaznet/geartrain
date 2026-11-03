// Publish checks that need no database: schema validity and version overlap.

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { readFileSync } from "node:fs";
import { overlappingVersions } from "./versions.ts";
import type { RuleFile } from "./types.ts";

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

const schemaUrl = new URL("../rules/rule.schema.json", import.meta.url);

export interface ValidationReport {
  ok: boolean;
  schemaErrors: string[];
  overlaps: string[];
}

export function validateRuleFile(data: unknown): ValidationReport {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(schemaUrl, "utf8")));
  const valid = validate(data);
  const schemaErrors = valid
    ? []
    : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
  const overlaps = valid ? overlappingVersions((data as RuleFile).rules) : [];
  return { ok: schemaErrors.length === 0 && overlaps.length === 0, schemaErrors, overlaps };
}

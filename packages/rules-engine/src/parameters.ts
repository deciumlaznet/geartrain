// Dated thresholds for the derived-value algorithms. A Budget change is a new
// entry in rules/parameters.json, never a code change.

import type { ISODate } from "./types.ts";

export interface SizeLimits {
  turnover: number;
  balanceSheet: number;
  employees: number;
}

export interface ParameterValues {
  companySize: { micro: SizeLimits; small: SizeLimits; medium: SizeLimits };
  groupSizeGross: { small: SizeLimits; medium: SizeLimits };
  vat: { registration: number; deregistration: number };
  apprenticeshipLevy: { payBillThreshold: number; allowance: number };
  ecctaLargeOrganisation: SizeLimits;
}

export interface ParameterEntry<K extends keyof ParameterValues = keyof ParameterValues> {
  key: K;
  effectiveFrom: ISODate;
  sourceUrl?: string;
  value: ParameterValues[K];
}

export interface ParameterFile {
  name: string;
  version: string;
  parameters: ParameterEntry[];
}

export function parameterAt<K extends keyof ParameterValues>(
  file: ParameterFile,
  key: K,
  asOf: ISODate,
): ParameterValues[K] {
  const candidates = file.parameters
    .filter((p) => p.key === key && p.effectiveFrom <= asOf)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  const hit = candidates[0];
  if (!hit) throw new Error(`No ${key} parameters in force on ${asOf}`);
  return hit.value as ParameterValues[K];
}

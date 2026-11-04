// Date-aware rule version selection.

import { addMonths } from "./dates.ts";
import type { ISODate, Rule } from "./types.ts";

function covers(r: Rule, asOf: ISODate): boolean {
  return r.effectiveFrom <= asOf && (r.effectiveTo == null || asOf < r.effectiveTo);
}

/** The one inForce version of a rule on a date, or undefined if none applies. */
export function versionFor(rules: Rule[], ruleId: string, asOf: ISODate): Rule | undefined {
  const hits = rules.filter((r) => r.id === ruleId && r.status === "inForce" && covers(r, asOf));
  if (hits.length > 1) {
    throw new Error(`Rule ${ruleId} has ${hits.length} inForce versions on ${asOf}; publishing should have blocked this`);
  }
  return hits[0];
}

export function inForceOn(rules: Rule[], asOf: ISODate): Rule[] {
  const ids = [...new Set(rules.map((r) => r.id))];
  return ids.map((id) => versionFor(rules, id, asOf)).filter((r): r is Rule => r !== undefined);
}

/** Enacted and announced versions starting within the horizon: notices, not tasks. */
export function upcoming(rules: Rule[], asOf: ISODate, horizonMonths = 18): Rule[] {
  const until = addMonths(asOf, horizonMonths);
  return rules.filter(
    (r) => (r.status === "enacted" || r.status === "announced") && r.effectiveFrom > asOf && r.effectiveFrom <= until,
  );
}

/** Publish check 2: no two inForce versions of one rule overlap in time. */
export function overlappingVersions(rules: Rule[]): string[] {
  const problems: string[] = [];
  const byId = new Map<string, Rule[]>();
  for (const r of rules.filter((x) => x.status === "inForce")) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  for (const [id, versions] of byId) {
    const sorted = [...versions].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1] as Rule;
      const next = sorted[i] as Rule;
      if (prev.effectiveTo == null || prev.effectiveTo > next.effectiveFrom) {
        problems.push(`${id}: v${prev.version} overlaps v${next.version}`);
      }
    }
  }
  return problems;
}

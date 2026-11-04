// Evaluates the rule condition grammar against an entity's facts. Every value
// read is recorded so the result can be explained later (the evaluation trace).

import type { CompanySize, Condition, Test } from "./types.ts";

const SIZE_ORDER: CompanySize[] = ["micro", "small", "medium", "large"];

export interface Context {
  fact: Record<string, unknown>;
  series: Record<string, unknown>;
  derived: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

export type Trace = Record<string, unknown>;

export class MissingValueError extends Error {
  constructor(public readonly path: string) {
    super(`No value for ${path}`);
  }
}

export function lookup(path: string, ctx: Context): unknown {
  const [namespace, ...rest] = path.split(".");
  let value: unknown = ctx[namespace as keyof Context];
  for (const key of rest) {
    if (value === null || value === undefined || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function asNumber(v: unknown, path: string): number {
  if (typeof v !== "number" || Number.isNaN(v)) throw new MissingValueError(path);
  return v;
}

function test(t: Test, ctx: Context, trace: Trace): boolean {
  const v = lookup(t.field, ctx);
  trace[t.field] = v;
  if (v === undefined) throw new MissingValueError(t.field);
  switch (t.op) {
    case "gte":
      return asNumber(v, t.field) >= asNumber(t.value, "value");
    case "gt":
      return asNumber(v, t.field) > asNumber(t.value, "value");
    case "lt":
      return asNumber(v, t.field) < asNumber(t.value, "value");
    case "lte":
      return asNumber(v, t.field) <= asNumber(t.value, "value");
    case "eq":
      return v === t.value;
    case "in":
      return Array.isArray(t.value) && t.value.includes(v);
    case "has":
      return Array.isArray(v) && v.includes(t.value);
    case "sizeAtLeast": {
      const actual = SIZE_ORDER.indexOf(v as CompanySize);
      const wanted = SIZE_ORDER.indexOf(t.value as CompanySize);
      if (actual < 0 || wanted < 0) throw new MissingValueError(t.field);
      return actual >= wanted;
    }
  }
}

/**
 * Returns true or false, or throws MissingValueError when a fact the rule needs
 * is unknown. Callers treat "unknown" as its own outcome: the adviser is asked
 * for the fact rather than the rule silently not applying.
 */
export function evaluateCondition(c: Condition, ctx: Context, trace: Trace = {}): boolean {
  if (c === "always") return true;
  if ("all" in c) return c.all.every((x) => evaluateCondition(x, ctx, trace));
  if ("any" in c) return c.any.some((x) => evaluateCondition(x, ctx, trace));
  if ("not" in c) return !evaluateCondition(c.not, ctx, trace);
  return test(c, ctx, trace);
}

export function sizeAtLeast(a: CompanySize, b: CompanySize): boolean {
  return SIZE_ORDER.indexOf(a) >= SIZE_ORDER.indexOf(b);
}

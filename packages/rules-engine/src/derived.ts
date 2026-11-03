// Derived values: the only legal tests implemented in code. Thresholds come in
// as parameters so they stay data. Each function follows the numbered section
// of the rule engine build specification it names.

import { addDays, addMonths, firstDayOfMonth, lastDayOfMonth, monthsBetweenInclusive, addMonthsToMonth } from "./dates.ts";
import type { SizeLimits } from "./parameters.ts";
import type { CompanySize, ISODate, Month } from "./types.ts";

// ---- 1 and 2. Company and group size ------------------------------------

export interface FinancialYearFigures {
  start: ISODate;
  end: ISODate;
  lengthInMonths: number;
  turnoverPence: number;
  balanceSheetPence: number;
  /** headcountMonth for each month of the year, in order. */
  headcountMonths: number[];
}

export function turnoverAdjusted(fy: FinancialYearFigures): number {
  return (fy.turnoverPence * 12) / fy.lengthInMonths;
}

export function averageHeadcountFY(fy: FinancialYearFigures): number {
  const total = fy.headcountMonths.reduce((a, b) => a + b, 0);
  return total / fy.lengthInMonths;
}

/** "Not more than" tests: equal to a threshold meets it. Two of three needed. */
export function meets(limits: SizeLimits, fy: FinancialYearFigures): boolean {
  const passes = [
    turnoverAdjusted(fy) <= limits.turnover,
    fy.balanceSheetPence <= limits.balanceSheet,
    averageHeadcountFY(fy) <= limits.employees,
  ].filter(Boolean).length;
  return passes >= 2;
}

/**
 * Two-year rule (CA 2006 s382(2) and s465(2)). `years` is in date order; the
 * first entry is the company's first financial year. Returns the size for
 * every year.
 */
export function companySizes(
  years: FinancialYearFigures[],
  limits: { micro?: SizeLimits; small: SizeLimits; medium: SizeLimits },
): CompanySize[] {
  const tiers = (["micro", "small", "medium"] as const).filter((t) => limits[t] !== undefined);
  const qualifies: Record<string, boolean[]> = {};
  for (const tier of tiers) {
    const l = limits[tier] as SizeLimits;
    const q: boolean[] = [];
    years.forEach((fy, n) => {
      const now = meets(l, fy);
      if (n === 0) {
        q.push(now);
        return;
      }
      const prevFy = years[n - 1] as FinancialYearFigures;
      const before = meets(l, prevFy);
      const qPrev = q[n - 1] as boolean;
      q.push((now && before) || (now && qPrev) || (before && qPrev));
    });
    qualifies[tier] = q;
  }
  return years.map((_, n) => tiers.find((t) => qualifies[t]?.[n]) ?? "large");
}

// ---- 3. VAT ---------------------------------------------------------------

export type VatOutcome =
  | { kind: "register"; test: "backward" | "forward"; triggerDate: ISODate; deadline: ISODate; effectiveDate: ISODate }
  | { kind: "askForException"; triggerDate: ISODate }
  | { kind: "none" };

/** Sum of the 12 months ending with `month`. Missing months count as unknown. */
export function rolling12(series: Record<Month, number>, month: Month): number | undefined {
  let total = 0;
  for (const m of monthsBetweenInclusive(addMonthsToMonth(month, -11), month)) {
    const v = series[m];
    if (v === undefined) return undefined;
    total += v;
  }
  return total;
}

export function vatBackwardTest(args: {
  vatRegistered: boolean;
  taxableTurnoverByMonth: Record<Month, number>;
  month: Month;
  expectedTaxableTurnoverNext12Months?: number;
  thresholds: { registration: number; deregistration: number };
}): VatOutcome {
  if (args.vatRegistered) return { kind: "none" };
  const total = rolling12(args.taxableTurnoverByMonth, args.month);
  if (total === undefined || total <= args.thresholds.registration) return { kind: "none" };
  const monthEnd = lastDayOfMonth(`${args.month}-01`);
  if (
    args.expectedTaxableTurnoverNext12Months !== undefined &&
    args.expectedTaxableTurnoverNext12Months <= args.thresholds.deregistration
  ) {
    return { kind: "askForException", triggerDate: monthEnd };
  }
  return {
    kind: "register",
    test: "backward",
    triggerDate: monthEnd,
    deadline: addDays(monthEnd, 30),
    effectiveDate: firstDayOfMonth(addMonths(`${args.month}-01`, 2)),
  };
}

export function vatForwardTest(args: {
  vatRegistered: boolean;
  day: ISODate;
  expectedTaxableTurnoverNext30Days: number;
  thresholds: { registration: number };
}): VatOutcome {
  if (args.vatRegistered || args.expectedTaxableTurnoverNext30Days <= args.thresholds.registration) {
    return { kind: "none" };
  }
  // Day 29: the last day of the 30-day period that starts on `day` (expert to confirm).
  return { kind: "register", test: "forward", triggerDate: args.day, deadline: addDays(args.day, 29), effectiveDate: args.day };
}

// ---- 4. Headcount bases -----------------------------------------------------

export function average12Months(endOfMonth: Record<Month, number>, month: Month): number | undefined {
  const months = monthsBetweenInclusive(addMonthsToMonth(month, -11), month);
  const values = months.map((m) => endOfMonth[m]);
  if (values.some((v) => v === undefined)) return undefined;
  return (values as number[]).reduce((a, b) => a + b, 0) / 12;
}

// ---- 5. Apprenticeship levy ---------------------------------------------------

export interface LevyResult {
  liable: string[];
  sharedAllowancePence: number;
  connectedPayBillPence: number;
}

/** The whole connected set is liable once its combined pay bill passes the threshold. */
export function apprenticeshipLevy(
  connectedPayBills: Record<string, number>,
  params: { payBillThreshold: number; allowance: number },
): LevyResult {
  const total = Object.values(connectedPayBills).reduce((a, b) => a + b, 0);
  const liable = total > params.payBillThreshold ? Object.keys(connectedPayBills) : [];
  return { liable, sharedAllowancePence: liable.length ? params.allowance : 0, connectedPayBillPence: total };
}

// ---- 6. ECCTA large organisation ("more than", unlike company size) ---------

export function largeOrganisationEccta(
  fy: { employees: number; turnoverPence: number; balanceSheetPence: number },
  limits: SizeLimits,
): boolean {
  return (
    [fy.employees > limits.employees, fy.turnoverPence > limits.turnover, fy.balanceSheetPence > limits.balanceSheet].filter(Boolean)
      .length >= 2
  );
}

// Turns a client's facts, monthly series and filed accounts into what the rules
// engine reads on a given date: facts in force, series values, derived values
// (size, headcount, VAT test, MTD qualifying income) and deadline anchors.

import {
  addDays,
  addMonths,
  addMonthsToMonth,
  average12Months,
  companySizes,
  largeOrganisationEccta,
  lastDayOfMonth,
  monthOf,
  monthsBetweenInclusive,
  parameterAt,
  rolling12,
  vatBackwardTest,
  type Anchors,
  type CompanySize,
  type Context,
  type FinancialYearFigures,
  type ISODate,
  type Month,
  type ParameterFile,
  type Rule,
} from "@geartrain/rules-engine";
import type { ClientDataset } from "@geartrain/synthetic";

export interface EntityContext {
  ctx: Context;
  derivedForRule: (rule: Rule) => Record<string, unknown>;
  anchors: Anchors;
  triggerDates: Record<string, ISODate>;
}

/**
 * Answers the client gives at onboarding for values no system holds. The
 * synthetic clients have no redundancies planned.
 */
export interface OnboardingAnswers {
  proposedDismissals90Days: number;
}

export const DEFAULT_ANSWERS: OnboardingAnswers = { proposedDismissals90Days: 0 };

type SeriesByMonth = Record<Month, number>;

export function seriesMaps(d: ClientDataset): Record<string, SeriesByMonth> {
  const out: Record<string, SeriesByMonth> = {};
  for (const p of d.engine.series) (out[p.series] ??= {})[p.month] = p.value;
  return out;
}

/** The last month whose figures are complete on `asOf`. */
export function lastCompleteMonth(asOf: ISODate): Month {
  return asOf === lastDayOfMonth(asOf) ? monthOf(asOf) : addMonthsToMonth(monthOf(asOf), -1);
}

/** The financial year end on or after `asOf`. `fye` is MM-DD. */
export function currentYearEnd(asOf: ISODate, fye: string): ISODate {
  const y = Number(asOf.slice(0, 4));
  const thisYear = `${y}-${fye}`;
  return thisYear >= asOf ? thisYear : `${y + 1}-${fye}`;
}

/** Completed financial years with full monthly figures, oldest first. */
export function completedYears(d: ClientDataset, asOf: ISODate, series = seriesMaps(d)): FinancialYearFigures[] {
  const fye = d.profile.entity.financialYearEnd;
  const turnover = series.turnover ?? {};
  const headcount = series.headcountMonth ?? {};
  const accounts = d.filings.filter((f) => f.kind === "annualAccounts");
  const years: FinancialYearFigures[] = [];
  let end = currentYearEnd(asOf, fye);
  if (end >= asOf) end = addMonths(end, -12);
  for (let i = 0; i < 10; i++, end = addMonths(end, -12)) {
    const start = addDays(addMonths(end, -12), 1);
    const months = monthsBetweenInclusive(monthOf(start), monthOf(end));
    if (months.some((m) => turnover[m] === undefined)) break;
    const acc = accounts.find((a) => a.periodEnd === end);
    years.unshift({
      start,
      end,
      lengthInMonths: months.length,
      turnoverPence: months.reduce((s, m) => s + (turnover[m] ?? 0), 0),
      balanceSheetPence: acc?.figures.balanceSheetTotal ?? Number.NaN,
      headcountMonths: months.map((m) => headcount[m] ?? 0),
    });
  }
  return years;
}

export function entityContext(d: ClientDataset, asOf: ISODate, params: ParameterFile, answers: OnboardingAnswers = DEFAULT_ANSWERS): EntityContext {
  const e = d.profile.entity;
  const series = seriesMaps(d);
  const m = lastCompleteMonth(asOf);

  // Facts in force on the date: the latest by appliesFrom.
  const fact: Record<string, unknown> = {};
  const ordered = [...d.engine.facts].filter((f) => f.appliesFrom <= asOf).sort((a, b) => (a.appliesFrom < b.appliesFrom ? -1 : 1));
  for (const f of ordered) fact[f.field] = f.value;

  const hcEnd = series.headcountEndOfMonth ?? {};
  const presentNow = hcEnd[m] ?? 0;
  const roll = (name: string) => (series[name] ? rolling12(series[name]!, m) : undefined);

  const years = completedYears(d, asOf, series);
  const lastYear = years.at(-1);
  const derived: Record<string, unknown> = {};

  derived.headcount = presentNow;
  if (lastYear) derived.turnoverFY = lastYear.turnoverPence;

  // MTD for Income Tax: qualifying income on the return for the tax year two years before the current one.
  if (e.legalForm === "soleTrader") {
    const taxYearStart = asOf.slice(5) >= "04-06" ? Number(asOf.slice(0, 4)) : Number(asOf.slice(0, 4)) - 1;
    const sa = d.filings.find((f) => f.kind === "selfAssessment" && f.periodEnd === `${taxYearStart - 1}-04-05` && f.submittedOn && f.submittedOn <= asOf);
    if (sa) derived.mtdQualifyingIncome = sa.figures.qualifyingIncome;
  } else {
    derived.mtdQualifyingIncome = 0;
  }

  // Company size: the two-year rule over completed years whose balance sheet is known.
  let size: CompanySize | undefined;
  if (e.legalForm === "ltd") {
    const known = years.filter((y) => !Number.isNaN(y.balanceSheetPence));
    if (known.length > 0) {
      const limits = parameterAt(params, "companySize", asOf);
      size = companySizes(known, limits).at(-1);
      derived.companySize = size;
      const lastKnown = known.at(-1)!;
      derived.balanceSheetTotal = lastKnown.balanceSheetPence;
      derived.largeOrganisationEccta = largeOrganisationEccta(
        { employees: lastKnown.headcountMonths.reduce((a, b) => a + b, 0) / lastKnown.lengthInMonths, turnoverPence: lastKnown.turnoverPence, balanceSheetPence: lastKnown.balanceSheetPence },
        parameterAt(params, "ecctaLargeOrganisation", asOf),
      );
    }
  }

  // VAT backward test on the last complete month.
  const triggerDates: Record<string, ISODate> = {};
  const vatRegistered = fact.vatRegistered === true;
  const vat = vatBackwardTest({
    vatRegistered,
    taxableTurnoverByMonth: series.taxableTurnover ?? {},
    month: m,
    thresholds: parameterAt(params, "vat", lastDayOfMonth(`${m}-01`)),
  });
  derived.vatBackwardTestMet = vat.kind === "register";
  if (vat.kind === "register") triggerDates["vat-registration"] = vat.triggerDate;

  const payBill = roll("payBillClass1");
  if (payBill !== undefined) derived.payBillConnectedAnnual = payBill;

  const seriesNow: Record<string, unknown> = { headcountEndOfMonth: presentNow };
  for (const [name, key] of [
    ["taxableTurnover", "taxableTurnoverRolling12"],
    ["turnover", "turnoverRolling12"],
    ["payBillClass1", "payBillClass1Rolling12"],
  ] as const) {
    const v = roll(name);
    if (v !== undefined) seriesNow[key] = v;
  }

  const average12 = average12Months(hcEnd, m);
  const averageFY = lastYear ? lastYear.headcountMonths.reduce((a, b) => a + b, 0) / lastYear.lengthInMonths : undefined;
  const derivedForRule = (rule: Rule): Record<string, unknown> => {
    switch (rule.headcountBasis) {
      case "averageFY":
        return averageFY === undefined ? {} : { headcount: averageFY };
      case "average12Months":
        return average12 === undefined ? {} : { headcount: average12 };
      case "proposedDismissals90Days":
        return { headcount: answers.proposedDismissals90Days };
      default:
        return { headcount: presentNow };
    }
  };

  const yearEnd = currentYearEnd(asOf, e.financialYearEnd);
  const taxYearEnd = currentYearEnd(asOf, "04-05");
  const taxMonthEnd = asOf.slice(8) <= "05" ? `${asOf.slice(0, 8)}05` : `${addMonthsToMonth(monthOf(asOf), 1)}-05`;
  const anchors: Anchors = {
    financialYearEnd: yearEnd,
    periodEnd: yearEnd,
    taxYearEnd,
    taxMonthEnd,
    ...(e.incorporationDate ? { incorporationDate: e.incorporationDate } : {}),
  };

  return { ctx: { fact, series: seriesNow, derived }, derivedForRule, anchors, triggerDates };
}

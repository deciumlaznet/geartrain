// A stand-in for the Companies House public data API, built from the synthetic
// companies' filing histories.

import { addDays, addMonths } from "@geartrain/rules-engine";
import type { ClientDataset } from "@geartrain/synthetic";
import type { CompanyProfile, CompanyRegistry, FilingHistoryItem } from "./types.ts";

export class MockCompaniesHouse implements CompanyRegistry {
  private readonly companies = new Map<string, ClientDataset>();

  constructor(
    datasets: ClientDataset[],
    private readonly asOf: string,
  ) {
    for (const d of datasets) if (d.profile.entity.companyNumber) this.companies.set(d.profile.entity.companyNumber, d);
  }

  async profile(companyNumber: string): Promise<CompanyProfile | undefined> {
    const d = this.companies.get(companyNumber);
    if (!d) return undefined;
    const e = d.profile.entity;
    const filed = (kind: string) =>
      d.filings
        .filter((f) => f.kind === kind && f.submittedOn && f.submittedOn <= this.asOf)
        .sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1))
        .at(-1);
    const accounts = filed("annualAccounts");
    const cs = filed("confirmationStatement");
    const incorporatedOn = e.incorporationDate ?? "";
    // First accounts: made up to the first accounting reference date, due 21 months after incorporation.
    const firstArd = firstReferenceDate(incorporatedOn, e.financialYearEnd);
    const accNextMadeUpTo = accounts ? addMonths(accounts.periodEnd, 12) : firstArd;
    const accNextDue = accounts ? addMonths(accNextMadeUpTo, 9) : addMonths(incorporatedOn, 21);
    const csNextMadeUpTo = cs ? addMonths(cs.periodEnd, 12) : addDays(addMonths(incorporatedOn, 12), -1);
    const csNextDue = addDays(csNextMadeUpTo, 14);
    return {
      companyNumber,
      companyName: e.name,
      incorporatedOn,
      registeredOffice: e.registeredOffice,
      accounts: { ...(accounts ? { lastMadeUpTo: accounts.periodEnd } : {}), nextMadeUpTo: accNextMadeUpTo, nextDue: accNextDue, overdue: accNextDue < this.asOf },
      confirmationStatement: { ...(cs ? { lastMadeUpTo: cs.periodEnd } : {}), nextMadeUpTo: csNextMadeUpTo, nextDue: csNextDue, overdue: csNextDue < this.asOf },
    };
  }

  async filingHistory(companyNumber: string): Promise<FilingHistoryItem[]> {
    const d = this.companies.get(companyNumber);
    if (!d) return [];
    const items: FilingHistoryItem[] = [];
    if (d.profile.entity.incorporationDate) items.push({ date: d.profile.entity.incorporationDate, type: "IN01", description: "Incorporation" });
    for (const f of d.filings) {
      if (!f.submittedOn || f.submittedOn > this.asOf) continue;
      if (f.kind === "annualAccounts") items.push({ date: f.submittedOn, type: "AA", description: "Accounts", madeUpTo: f.periodEnd });
      if (f.kind === "confirmationStatement") items.push({ date: f.submittedOn, type: "CS01", description: "Confirmation statement", madeUpTo: f.periodEnd });
    }
    return items.sort((a, b) => (a.date < b.date ? 1 : -1));
  }
}

/** The first financial year end falling more than 6 months after incorporation (simplified). */
function firstReferenceDate(incorporatedOn: string, fye: string): string {
  const year = Number(incorporatedOn.slice(0, 4));
  for (const y of [year, year + 1, year + 2]) {
    const candidate = `${y}-${fye}`;
    if (candidate > addMonths(incorporatedOn, 6)) return candidate;
  }
  return `${year + 1}-${fye}`;
}

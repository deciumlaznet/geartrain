// A stand-in for HMRC's obligations APIs, built from a synthetic client's filing
// history. Open obligations roll forward to the "as of" date the way HMRC's
// do. Submitting is refused: in the pilot Geartrain never files or replies to
// HMRC itself.

import { addDays, addMonths, lastDayOfMonth } from "@geartrain/rules-engine";
import type { ClientDataset, Filing } from "@geartrain/synthetic";
import { NotSupportedError, type DateRange, type TaxAuthority, type TaxObligation } from "./types.ts";

const REGIME: Partial<Record<Filing["kind"], TaxObligation["regime"]>> = {
  vatReturn: "vat",
  mtdQuarterlyUpdate: "itsaQuarterly",
  selfAssessment: "selfAssessment",
  ct600: "corporationTax",
  payeMonthly: "paye",
};

export class MockHmrc implements TaxAuthority {
  readonly sandbox = true;
  private readonly all: TaxObligation[];

  constructor(dataset: ClientDataset, asOf: string) {
    const known: TaxObligation[] = [];
    for (const f of dataset.filings) {
      const regime = REGIME[f.kind];
      if (!regime) continue;
      const fulfilled = f.submittedOn !== undefined && f.submittedOn <= asOf;
      known.push({
        regime,
        periodKey: periodKey(regime, f.periodEnd),
        start: f.periodStart,
        end: f.periodEnd,
        due: f.dueDate,
        status: fulfilled ? "F" : "O",
        ...(fulfilled ? { received: f.submittedOn } : {}),
      });
    }
    this.all = [...known, ...rollForward(known, asOf)].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.regime < b.regime ? -1 : 1));
  }

  async obligations(filter: DateRange & { status?: "O" | "F"; regime?: TaxObligation["regime"] } = {}) {
    return this.all
      .filter((o) => (!filter.status || o.status === filter.status) && (!filter.regime || o.regime === filter.regime))
      .filter((o) => (!filter.from || o.end >= filter.from) && (!filter.to || o.start <= filter.to))
      .map((o) => ({ ...o }));
  }

  async submitReturn(regime: TaxObligation["regime"], _periodKey: string): Promise<never> {
    throw new NotSupportedError(`submitReturn(${regime})`, "Geartrain does not file with HMRC in the pilot; the return is filed in Xero or by the client");
  }
}

function periodKey(regime: TaxObligation["regime"], end: string): string {
  // HMRC uses opaque keys like "24A1"; ours are readable and stable.
  return `${regime}:${end}`;
}

/** Periods that have started by `asOf` but are not in the history yet. */
function rollForward(known: TaxObligation[], asOf: string): TaxObligation[] {
  const out: TaxObligation[] = [];
  const latest = (regime: TaxObligation["regime"]) => known.filter((o) => o.regime === regime).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
  const roll = (regime: TaxObligation["regime"], months: number, due: (end: string) => string) => {
    let last = latest(regime);
    while (last) {
      const start = addDays(last.end, 1);
      if (start > asOf) break;
      const end = lastDayOfMonth(addMonths(start, months - 1));
      const o: TaxObligation = { regime, periodKey: periodKey(regime, end), start, end, due: due(end), status: "O" };
      out.push(o);
      last = o;
    }
  };
  // VAT: one month and seven days after the quarter ends.
  roll("vat", 3, (end) => addDays(addMonths(end, 1), 7));
  // Corporation tax: the return is due 12 months after the accounting period ends.
  roll("corporationTax", 12, (end) => addMonths(end, 12));
  return out;
}

// Calendar arithmetic on ISO dates (YYYY-MM-DD). All dates are calendar days in
// Europe/London; we compute in UTC so no daylight-saving shift can move a day.

import type { ISODate, Month, Offset } from "./types.ts";

const DAY_MS = 86_400_000;

function toUtc(d: ISODate): number {
  const [y, m, day] = parse(d);
  return Date.UTC(y, m - 1, day);
}

function fromUtc(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function parse(d: ISODate): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!match) throw new Error(`Not an ISO date: ${d}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function format(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function lastDayOfMonth(d: ISODate): ISODate {
  const [y, m] = parse(d);
  return format(y, m, daysInMonth(y, m));
}

export function firstDayOfMonth(d: ISODate): ISODate {
  const [y, m] = parse(d);
  return format(y, m, 1);
}

export function isLastDayOfMonth(d: ISODate): boolean {
  return lastDayOfMonth(d) === d;
}

export function addDays(d: ISODate, days: number): ISODate {
  return fromUtc(toUtc(d) + days * DAY_MS);
}

/**
 * Add calendar months. Keeps the day of the month; if that day does not exist
 * the result is the last day of the target month; if the start is the last day
 * of a month the result is the last day of the target month (30 June + 9 months
 * = 31 March). This is the Companies Act convention, used everywhere.
 */
export function addMonths(d: ISODate, months: number): ISODate {
  const [y, m, day] = parse(d);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  const last = daysInMonth(ty, tm);
  if (isLastDayOfMonth(d)) return format(ty, tm, last);
  return format(ty, tm, Math.min(day, last));
}

/** Months first, then days, matching how deadlines are written ("9 months and 1 day"). */
export function addOffset(d: ISODate, offset: Offset): ISODate {
  return addDays(addMonths(d, offset.months ?? 0), offset.days ?? 0);
}

export function compare(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function monthOf(d: ISODate): Month {
  return d.slice(0, 7);
}

export function addMonthsToMonth(m: Month, months: number): Month {
  return monthOf(addMonths(`${m}-01`, months));
}

/** Whole months between two month keys, inclusive of both ends. */
export function monthsBetweenInclusive(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let m = from; m <= to; m = addMonthsToMonth(m, 1)) out.push(m);
  return out;
}

export function isWeekend(d: ISODate): boolean {
  const dow = new Date(toUtc(d)).getUTCDay();
  return dow === 0 || dow === 6;
}

export function previousWorkingDay(d: ISODate, holidays: ReadonlySet<ISODate>): ISODate {
  let x = d;
  while (isWeekend(x) || holidays.has(x)) x = addDays(x, -1);
  return x;
}

export function nextWorkingDay(d: ISODate, holidays: ReadonlySet<ISODate>): ISODate {
  let x = d;
  while (isWeekend(x) || holidays.has(x)) x = addDays(x, 1);
  return x;
}

/** The first date strictly after `after` that falls on the given MM-DD. */
export function nextFixed(mmdd: string, after: ISODate): ISODate {
  const [y] = parse(after);
  const [mm, dd] = mmdd.split("-").map(Number) as [number, number];
  for (const year of [y, y + 1]) {
    const candidate = format(year, mm, Math.min(dd, daysInMonth(year, mm)));
    if (candidate > after) return candidate;
  }
  throw new Error("unreachable");
}

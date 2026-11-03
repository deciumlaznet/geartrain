// Turns an obligation's deadline formula into a date, and works out when to
// remind. Filing deadlines never move; only reminders shift to a working day.

import { addDays, addOffset, nextFixed, nextWorkingDay, previousWorkingDay } from "./dates.ts";
import { lookup, type Context } from "./conditions.ts";
import type { Anchor, Deadline, ISODate, Obligation } from "./types.ts";

export type Anchors = Partial<Record<Exclude<Anchor, "fixed">, ISODate>>;

export class MissingAnchorError extends Error {
  constructor(public readonly anchor: string) {
    super(`No date for anchor ${anchor}`);
  }
}

/**
 * For anchor "fixed", the deadline is the first MM-DD after the reference date
 * (the period end if known, else the trigger date), then the offset.
 */
export function computeDeadline(d: Deadline, anchors: Anchors, ctx?: Context): ISODate {
  let base: ISODate | undefined;
  if (d.payloadField) {
    const v = ctx ? lookup(d.payloadField, ctx) : undefined;
    if (typeof v !== "string") throw new MissingAnchorError(d.payloadField);
    base = v;
  } else if (d.anchor === "fixed") {
    if (!d.fixed) throw new MissingAnchorError("fixed");
    const reference = anchors.periodEnd ?? anchors.taxYearEnd ?? anchors.triggerDate;
    if (!reference) throw new MissingAnchorError("fixed reference");
    base = nextFixed(d.fixed, reference);
  } else {
    base = anchors[d.anchor];
  }
  if (!base) throw new MissingAnchorError(d.anchor);
  return addOffset(base, d.offset);
}

export function reminderDates(o: Obligation, deadline: ISODate, holidays: ReadonlySet<ISODate>): ISODate[] {
  const adjust = o.deadline.adjust ?? "none";
  const target =
    adjust === "previousWorkingDay"
      ? previousWorkingDay(deadline, holidays)
      : adjust === "nextWorkingDay"
        ? nextWorkingDay(deadline, holidays)
        : deadline;
  return (o.remindDaysBefore ?? []).map((n) => addDays(target, -n));
}

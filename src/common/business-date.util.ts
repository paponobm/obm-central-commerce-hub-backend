// The business operates out of Bangladesh. Every "what day is this" or
// "give me the last N days" computation in reports must follow Dhaka
// calendar days, not the Node process's own system timezone — plain JS
// `Date` + `toISOString()` is UTC and silently misclassifies orders placed
// in the early morning (Dhaka is UTC+6) into the previous day. This is a
// real bug class (caught once already in the dashboard — see Phase 8),
// centralized here so it isn't re-derived, and potentially re-broken, in
// every new report.
export const BUSINESS_TIMEZONE = 'Asia/Dhaka';
// Bangladesh has used a single fixed UTC+6 offset with no DST since 2009 —
// safe to hardcode rather than pull in a timezone library.
const BUSINESS_TZ_OFFSET = '+06:00';

// Today's date as YYYY-MM-DD in the business timezone, regardless of the
// server's own system timezone.
export function businessToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
  }).format(new Date());
}

// A YYYY-MM-DD calendar date string -> the UTC instant of that day's start
// (00:00:00) in the business timezone.
export function businessStartOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00${BUSINESS_TZ_OFFSET}`);
}

// A YYYY-MM-DD calendar date string -> the UTC instant of that day's end
// (23:59:59.999) in the business timezone — for an inclusive "to" bound.
export function businessEndOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999${BUSINESS_TZ_OFFSET}`);
}

// Resolves optional from/to query params (YYYY-MM-DD, business-local) into
// a concrete instant range, defaulting to the last `defaultDays` days
// (inclusive of today) when omitted.
export function resolveDateRange(
  from?: string,
  to?: string,
  defaultDays = 30,
): { gte: Date; lte: Date } {
  const today = businessToday();
  const lte = to ? businessEndOfDay(to) : businessEndOfDay(today);

  let gte: Date;
  if (from) {
    gte = businessStartOfDay(from);
  } else {
    const start = businessStartOfDay(today);
    start.setUTCDate(start.getUTCDate() - (defaultDays - 1));
    gte = start;
  }

  return { gte, lte };
}

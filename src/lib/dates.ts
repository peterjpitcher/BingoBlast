// src/lib/dates.ts
//
// Every user-facing date in this app is about a pub in Stanwell Moor, so every
// user-facing date is Europe/London. Nothing here is for machine timestamps:
// those stay as ISO strings and are compared as numbers.
//
// WHY THIS EXISTS
//   Four screens formatted dates with bare `new Date(x).toLocaleDateString()`,
//   which uses the runtime's timezone and locale. On Vercel that runtime is UTC
//   with an en-US default, so Winner History rendered "7/29/2026" for a win
//   recorded at 21:57 London time, and a win recorded just after midnight BST
//   showed as the previous day. Neither is wrong by a lot, and both are wrong in
//   the way that makes someone distrust the whole page.

const LONDON = 'Europe/London';
const LOCALE = 'en-GB';

/**
 * A date on its own: "29 July 2026".
 *
 * Accepts a `date` column (a bare 'YYYY-MM-DD', which has no time and no zone)
 * as well as a timestamp. A bare date string is deliberately NOT run through
 * timezone conversion: it already means the day it says.
 */
export function formatDateInLondon(value: string | Date | null | undefined): string {
  if (!value) return '';

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat(LOCALE, {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: LONDON,
  }).format(date);
}

/**
 * A date and a time: "29 July 2026, 21:57".
 *
 * The time of day matters on this screen. Two wins five minutes apart on the
 * same stage are the difference between a tie and a mistake, and a date alone
 * cannot tell them apart.
 */
export function formatDateTimeInLondon(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const formatted = new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: LONDON,
  }).format(date);

  // en-GB renders the long-month form as "30 July 2026 at 00:30" and the short
  // form as "4 Jul 2026, 13:00". Normalising to the comma keeps the two
  // consistent, and keeps this stable across ICU versions, which have changed
  // this separator before.
  return formatted.replace(' at ', ', ');
}

/** Short form for a dense table: "29 Jul 2026, 21:57". */
export function formatShortDateTimeInLondon(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: LONDON,
  }).format(date).replace(' at ', ', ');
}

/** Today's date in London as 'YYYY-MM-DD', for writing to a `date` column. */
export function getTodayIsoDateInLondon(): string {
  // en-CA renders as YYYY-MM-DD, which is the shape a Postgres `date` wants.
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: LONDON,
  }).format(new Date());
}

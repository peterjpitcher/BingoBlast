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

/**
 * The London calendar date of an instant, as 'YYYY-MM-DD'. Empty for anything
 * that is not a valid date, never "Invalid Date".
 */
export function getLondonIsoDate(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  // en-CA renders as YYYY-MM-DD, which is the shape a Postgres `date` wants.
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: LONDON,
  }).format(date);
}

/**
 * Today's date in London as 'YYYY-MM-DD', for writing to a `date` column or
 * comparing with one. `now` is for tests; callers leave it out.
 */
export function getTodayIsoDateInLondon(now: Date = new Date()): string {
  return getLondonIsoDate(now);
}

interface LondonClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function readLondonClock(date: Date): LondonClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    hourCycle: 'h23', timeZone: LONDON,
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute') };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Fixed names rather than Intl output: ICU's en-GB short month for September
// is "Sept" in some versions and "Sep" in others, and a TV label should not
// change with the browser's ICU build.
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toValidDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Days since the epoch of a London calendar date, so two dates subtract as whole days. */
function londonDayNumber(clock: LondonClock): number {
  return Date.UTC(clock.year, clock.month - 1, clock.day) / DAY_MS;
}

/**
 * When an upcoming event is, as the pub TV and phones say it (spec 5.5):
 * "Tonight", "Tomorrow", a weekday name ("Friday") up to six days ahead, and
 * otherwise "Fri 16 Oct". Judged by London calendar dates, never by hours
 * apart, so an event at 00:30 is "Tomorrow" from 23:00 the night before and
 * the clock change does not shift a day. Empty for anything that is not a
 * date, never "Invalid Date".
 *
 * Worked out at render time from the event's start and the screen's clock, so
 * a cached events list is never wrong after midnight (R10).
 */
export function formatEventWhen(startsAtIso: string, nowIso: string | number | Date): string {
  const starts = toValidDate(startsAtIso);
  const now = toValidDate(nowIso);
  if (!starts || !now) return '';

  const event = readLondonClock(starts);
  const days = londonDayNumber(event) - londonDayNumber(readLondonClock(now));
  if (days === 0) return 'Tonight';
  if (days === 1) return 'Tomorrow';

  // A calendar date built at UTC midnight, so getUTCDay is its weekday.
  const weekday = new Date(Date.UTC(event.year, event.month - 1, event.day)).getUTCDay();
  if (days > 1 && days <= 6) return WEEKDAYS_LONG[weekday];
  return `${WEEKDAYS_SHORT[weekday]} ${event.day} ${MONTHS_SHORT[event.month - 1]}`;
}

/**
 * An event's start time in London, the way a pub poster says it: "7pm", or
 * "7:30pm" when it is not on the hour. Noon is "12pm" and midnight "12am".
 * Empty for anything that is not a date.
 */
export function formatEventTime(startsAtIso: string): string {
  const starts = toValidDate(startsAtIso);
  if (!starts) return '';
  const { hour, minute } = readLondonClock(starts);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? 'am' : 'pm';
  return minute === 0 ? `${hour12}${suffix}` : `${hour12}:${String(minute).padStart(2, '0')}${suffix}`;
}

const FOUR_AM = 4;

/**
 * The first 04:00 London time strictly after `fromIso`, as an ISO timestamp.
 * Null when `fromIso` is not a date.
 *
 * The pub TV stays on its end-of-night screen until then (spec A3), so a night
 * that ends at 21:37 holds until 04:00 the next morning, and one that ends at
 * 00:30 holds until 04:00 the same morning.
 *
 * Works on London wall-clock time, never on "add 24 hours": across the clock
 * change on 25 October the night is 25 hours long, and 04:00 is 04:00 GMT, not
 * 03:00. 04:00 always exists exactly once in London (the clocks change at 01:00
 * and 02:00), so one of the two candidate offsets always matches.
 */
export function nextLondonFourAm(fromIso: string): string | null {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return null;

  const now = readLondonClock(from);
  // Before 04:00 the next 04:00 is later the same calendar day; from 04:00 on
  // it is tomorrow's. Date.UTC rolls the day over months and years.
  const dayOffset = now.hour < FOUR_AM ? 0 : 1;
  const target = new Date(Date.UTC(now.year, now.month - 1, now.day + dayOffset));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth() + 1;
  const day = target.getUTCDate();

  // London is UTC+0 (GMT) or UTC+1 (BST).
  for (const offsetHours of [0, 1]) {
    const candidate = new Date(Date.UTC(year, month - 1, day, FOUR_AM - offsetHours));
    const clock = readLondonClock(candidate);
    if (clock.hour === FOUR_AM && clock.day === day && clock.month === month && clock.year === year) {
      return candidate.toISOString();
    }
  }
  return null;
}

/**
 * The one line the screens print under an event title: "Tonight at 7pm",
 * "Friday at 7:30pm", "Fri 16 Oct at 7pm". Empty for anything that is not a
 * date.
 */
export function formatEventWhenAndTime(startsAtIso: string, nowIso: string | number | Date): string {
  const when = formatEventWhen(startsAtIso, nowIso);
  const time = formatEventTime(startsAtIso);
  return when && time ? `${when} at ${time}` : '';
}

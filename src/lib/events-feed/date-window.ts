// src/lib/events-feed/date-window.ts
//
// The date ranges the feed asks the management app for. Calendar-date
// arithmetic only: the input is today's date in London (from
// getTodayIsoDateInLondon), and adding days to a calendar date has no time
// zone or daylight-saving question in it, so it is done in UTC throughout.

/** How far ahead the general events list looks. */
export const GENERAL_WINDOW_DAYS = 60;

/** How far ahead the bingo-night query looks, so the next one is found even in a quiet spell. */
export const BINGO_WINDOW_DAYS = 120;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Adds whole days to a YYYY-MM-DD calendar date. Throws on a malformed or
 * impossible date (2026-02-30), rather than rolling it over silently.
 */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const match = ISO_DATE_RE.exec(isoDate);
  if (!match || !Number.isInteger(days)) {
    throw new Error(`addDaysToIsoDate needs a YYYY-MM-DD date and whole days (got "${isoDate}", ${days}).`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`addDaysToIsoDate got an impossible date "${isoDate}".`);
  }
  date.setUTCDate(date.getUTCDate() + days);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

export interface EventsDateWindows {
  /** Today in London; both queries start here. */
  from: string;
  /** Today + 60 days, the end of the general list. */
  generalTo: string;
  /** Today + 120 days, the end of the bingo-night query. */
  bingoTo: string;
}

export function eventsDateWindows(todayIso: string): EventsDateWindows {
  return {
    from: addDaysToIsoDate(todayIso, 0),
    generalTo: addDaysToIsoDate(todayIso, GENERAL_WINDOW_DAYS),
    bingoTo: addDaysToIsoDate(todayIso, BINGO_WINDOW_DAYS),
  };
}

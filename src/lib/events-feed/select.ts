// src/lib/events-feed/select.ts
//
// Which events the screens show (spec 5.5, "Selection"). Pure: the current
// time is passed in, so it behaves the same in any server time zone.
//
// 1. Drop events that have already started, and any that are not scheduled.
// 2. Take bingo nights out of the general list; they only appear through the
//    next-bingo slot, which is fed by its own query.
// 3. Keep one occurrence per event name, the earliest.
// 4. Keep 8 at most.
//
// Bingo nights are taken out before the cap, so a busy bingo month never
// leaves the carousel short of other events. Bingo nights are never
// de-duplicated by name: they recur under the same name, and a TV needs the
// one after tonight's.

/** Most events in the general list. */
export const MAX_SCREEN_EVENTS = 8;

/** Most bingo nights kept; matches the query's limit. */
export const MAX_BINGO_NIGHTS = 5;

/** The management category slug for The Anchor's cash bingo nights. */
export const BINGO_NIGHT_CATEGORY = 'bingo-night';

export interface SelectableEvent {
  id: string;
  title: string;
  /** ISO 8601 instant with a zone. */
  startsAt: string;
  category: string | null;
  /** The management `event_status`; null or absent is treated as scheduled. */
  status?: string | null;
}

/** True once the event's start time has passed, or when it has no usable start. */
export function hasStarted(event: Pick<SelectableEvent, 'startsAt'>, nowMs: number): boolean {
  const startMs = Date.parse(event.startsAt);
  return !Number.isFinite(startMs) || startMs <= nowMs;
}

export function dropStarted<T extends Pick<SelectableEvent, 'startsAt'>>(
  events: readonly T[],
  nowMs: number,
): T[] {
  return events.filter((event) => !hasStarted(event, nowMs));
}

export function isBingoNight(event: Pick<SelectableEvent, 'category'>): boolean {
  return event.category === BINGO_NIGHT_CATEGORY;
}

function isScheduled(event: SelectableEvent): boolean {
  return event.status == null || event.status === 'scheduled';
}

/** Earliest first; ties broken by id so the order never depends on input order. */
function byStart(a: SelectableEvent, b: SelectableEvent): number {
  const diff = Date.parse(a.startsAt) - Date.parse(b.startsAt);
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Names that differ only in case or spacing are the same event. */
function nameKey(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface ScreenSelection<T> {
  events: T[];
  bingoNights: T[];
}

/**
 * Selects the general list and the bingo nights.
 *
 * `bingoNights` comes from the bingo-night category query. Any bingo nights in
 * the general list are merged in too (by id), so the next-bingo slot still
 * works if the category query found nothing.
 */
export function selectScreenEvents<T extends SelectableEvent>(
  general: readonly T[],
  bingoNights: readonly T[],
  nowMs: number,
): ScreenSelection<T> {
  const upcoming = dropStarted(general, nowMs).filter(isScheduled).sort(byStart);

  const events: T[] = [];
  const seenNames = new Set<string>();
  for (const event of upcoming) {
    if (events.length === MAX_SCREEN_EVENTS) break;
    if (isBingoNight(event)) continue;
    const key = nameKey(event.title);
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    events.push(event);
  }

  const candidates = [...dropStarted(bingoNights, nowMs).filter(isScheduled), ...upcoming.filter(isBingoNight)];
  const nights: T[] = [];
  const seenIds = new Set<string>();
  for (const event of candidates.sort(byStart)) {
    if (nights.length === MAX_BINGO_NIGHTS) break;
    if (seenIds.has(event.id)) continue;
    seenIds.add(event.id);
    nights.push(event);
  }

  return { events, bingoNights: nights };
}

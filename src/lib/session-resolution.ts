// src/lib/session-resolution.ts
//
// Which session a TV on /display, or a phone on /play, should join (spec A3).
// A session qualifies when it is running, or ready and dated today or earlier
// in London. A ready session dated in the future waits for its date, so next
// week's night can be set up without taking over tonight's TV. Test sessions
// only count in rehearsal (`/display?rehearsal=1`, spec A4).
import type { SessionStatus } from '@/types/database';

export interface ResolvableSession {
  id: string;
  status: SessionStatus;
  /** A Postgres `date`: 'YYYY-MM-DD'. */
  start_date: string | null;
  is_test_session: boolean;
}

export type DisplayResolution =
  | { kind: 'one'; id: string }
  | { kind: 'none' }
  | { kind: 'many'; ids: string[] };

export interface ResolveOptions {
  includeTest?: boolean;
}

/** The columns a caller must read for resolveDisplaySession. */
export const RESOLVABLE_SESSION_COLUMNS = 'id, name, status, start_date, is_test_session';

/** The statuses worth asking the database for; anything else never qualifies. */
export const CANDIDATE_SESSION_STATUSES: SessionStatus[] = ['ready', 'running'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `todayLondon` is today's date in London, 'YYYY-MM-DD'
 * (getTodayIsoDateInLondon()). Bare ISO dates compare correctly as strings.
 */
export function sessionQualifies(
  session: ResolvableSession,
  todayLondon: string,
  { includeTest = false }: ResolveOptions = {}
): boolean {
  if (session.is_test_session && !includeTest) return false;
  if (session.status === 'running') return true;
  if (session.status !== 'ready') return false;
  return typeof session.start_date === 'string' && ISO_DATE.test(session.start_date) && session.start_date <= todayLondon;
}

/**
 * One qualifying session: join it. None: idle. Several: let staff choose, with
 * running sessions listed first and the input order kept otherwise.
 */
export function resolveDisplaySession(
  sessions: ReadonlyArray<ResolvableSession>,
  nowLondonDate: string,
  options: ResolveOptions = {}
): DisplayResolution {
  const qualifying = sessions.filter((session) => sessionQualifies(session, nowLondonDate, options));
  if (qualifying.length === 0) return { kind: 'none' };
  if (qualifying.length === 1) return { kind: 'one', id: qualifying[0].id };
  const running = qualifying.filter((session) => session.status === 'running');
  const others = qualifying.filter((session) => session.status !== 'running');
  return { kind: 'many', ids: [...running, ...others].map((session) => session.id) };
}

/** '/display/<id>', keeping rehearsal mode ('?rehearsal=1') when it is on. */
export function displayPathFor(sessionId: string, { rehearsal = false }: { rehearsal?: boolean } = {}): string {
  return `/display/${encodeURIComponent(sessionId)}${rehearsal ? '?rehearsal=1' : ''}`;
}

/** Where a TV goes to find its next session: '/display', keeping rehearsal mode. */
export function displayLobbyPath({ rehearsal = false }: { rehearsal?: boolean } = {}): string {
  return rehearsal ? '/display?rehearsal=1' : '/display';
}

/** The sessions with these ids, in the order of `ids` (a resolution's order). */
export function pickSessionsByIds<S extends { id: string }>(sessions: ReadonlyArray<S>, ids: ReadonlyArray<string>): S[] {
  return ids
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is S => session !== undefined);
}

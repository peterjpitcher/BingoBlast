// src/lib/tv-tonight.ts
//
// Which session a paired /tv shows (spec S3.2, row C-6). Cash Bingo's rule is
// the one /display already uses (spec A3, src/lib/session-resolution.ts): a
// session qualifies when it is running, or ready and dated today or earlier
// in London; test sessions count only with `?rehearsal=1`.
//
// /display lets staff choose when several qualify. A paired TV has nobody to
// ask, so it takes the first in the resolution's order: a running session
// before a ready one, and otherwise the newest start date (the query orders
// by start_date, newest first).
import type { ResolveTonight } from '@anchor-nights/kit/pairing/shared';
import { getTodayIsoDateInLondon } from '@/lib/dates';
import {
  CANDIDATE_SESSION_STATUSES,
  RESOLVABLE_SESSION_COLUMNS,
  resolveDisplaySession,
  type ResolvableSession,
} from '@/lib/session-resolution';

/** What /tv needs to draw tonight's display: the session's id. */
export interface TonightSession {
  id: string;
}

/** Reads the candidate sessions, newest start date first. An error is an outage, never "no bingo tonight". */
export type CandidateSessionsReader = () => PromiseLike<{ data: ResolvableSession[] | null; error: unknown }>;

/** Tonight's session from the candidates, or null for the idle loop. `todayLondon` is 'YYYY-MM-DD'. */
export function pickTonight(
  sessions: ReadonlyArray<ResolvableSession>,
  todayLondon: string,
  rehearsal: boolean
): TonightSession | null {
  const resolution = resolveDisplaySession(sessions, todayLondon, { includeTest: rehearsal });
  if (resolution.kind === 'one') return { id: resolution.id };
  if (resolution.kind === 'many') return { id: resolution.ids[0] };
  return null;
}

/**
 * The kit's resolveTonight for Cash Bingo. It throws when the sessions cannot
 * be read, and the kit then shows "Reconnecting" (never a game, never a
 * pairing code) and retries.
 */
export function createFindTonight(read: CandidateSessionsReader): ResolveTonight<TonightSession> {
  return async ({ now, rehearsal }) => {
    const { data, error } = await read();
    if (error || !data) {
      throw error ?? new Error('The tonight lookup returned no rows and no error');
    }
    return pickTonight(data, getTodayIsoDateInLondon(now), rehearsal);
  };
}

/** The public candidate read /display uses, on the app's cookie client (anon key, public RLS). */
async function readCandidateSessions(): Promise<{ data: ResolvableSession[] | null; error: unknown }> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  return supabase
    .from('sessions')
    .select(RESOLVABLE_SESSION_COLUMNS)
    .in('status', CANDIDATE_SESSION_STATUSES)
    .order('start_date', { ascending: false })
    .returns<ResolvableSession[]>();
}

export const findTonight: ResolveTonight<TonightSession> = createFindTonight(readCandidateSessions);

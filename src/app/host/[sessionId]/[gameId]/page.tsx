import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect, notFound } from 'next/navigation';
import GameControl from './game-control';
import { Database } from '@/types/database';
import { buttonClass } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HostHeader, HostHeaderGameStatus } from '@/components/host/host-header';
import { getColourName } from '@/lib/colour-name';
import { isUuid } from '@/lib/utils';
import { reportError } from '@/lib/report-error';

interface PageProps {
  params: Promise<{ sessionId: string; gameId: string }>;
}

/**
 * PostgREST's "no rows returned by .single()". Only this means the thing is
 * genuinely not there. Anything else is a read that failed (X8): it used to
 * turn a database blip into a 404, or bounce the host to /host or /pending in
 * the middle of a game, and the host had to find their way back.
 */
const NO_ROWS_RETURNED = 'PGRST116';

/**
 * Shown when a read failed for any reason other than "no rows". A plain link
 * back to this same page, so Retry works even if the client bundle did not load.
 */
function LoadErrorScreen({ retryHref }: { retryHref: string }) {
  return (
    <div className="flex min-h-screen-safe items-center justify-center bg-anchor-green-deep p-6 text-anchor-cream-text">
      <Card role="alert" className="flex w-full max-w-sm flex-col items-center gap-4 p-6 text-center">
        <p className="text-lg font-semibold">Could not load the game.</p>
        <a href={retryHref} className={buttonClass({ variant: 'outline', size: 'md' })}>
          Retry
        </a>
      </Card>
    </div>
  );
}

export default async function GameControlPage({ params }: PageProps) {
  const { sessionId, gameId } = await params;

  if (!isUuid(sessionId) || !isUuid(gameId)) {
    notFound();
  }

  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Authentication is not authorisation. This used to be `if (!user)` alone,
  // which was safe only while every account that could exist was already staff.
  // New accounts land as 'pending', so a signed-in stranger would otherwise
  // render the whole host console and every button on it, and be refused only
  // once they pressed something. RLS and assert_is_host() would still deny the
  // data, but a screen that looks live and does nothing is worse than a screen
  // that says why.
  const retryHref = `/host/${sessionId}/${gameId}`;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<Pick<Database['public']['Tables']['profiles']['Row'], 'role'>>();

  // A failed read is not an answer about the role. Sending a working host to
  // /pending on a blip is what this used to do.
  if (profileError && profileError.code !== NO_ROWS_RETURNED) {
    void reportError({ scope: 'host-game-page' }, profileError);
    return <LoadErrorScreen retryHref={retryHref} />;
  }

  if (profile?.role !== 'admin' && profile?.role !== 'host') {
    redirect('/pending');
  }

  // Fetch game details
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .eq('session_id', sessionId)
    .single<Database['public']['Tables']['games']['Row']>();

  if (gameError?.code === NO_ROWS_RETURNED) {
    notFound();
  }
  if (gameError || !game) {
    void reportError({ scope: 'host-game-page' }, gameError ?? new Error('Game read returned no row and no error'));
    return <LoadErrorScreen retryHref={retryHref} />;
  }

  // Fetch session details (needed for context, e.g., session name)
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('name, status')
    .eq('id', sessionId)
    .single<Pick<Database['public']['Tables']['sessions']['Row'], 'name' | 'status'>>();

  if (sessionError?.code === NO_ROWS_RETURNED) {
    notFound();
  }
  if (sessionError || !session) {
    void reportError({ scope: 'host-game-page' }, sessionError ?? new Error('Session read returned no row and no error'));
    return <LoadErrorScreen retryHref={retryHref} />;
  }

  // Fetch initial game state, with the same cookie client, keeping the raw
  // error code: only that can tell "this game has not been started" (no row)
  // from a failed read. The claim fields come with it, which is how the host
  // screen reopens a claim in progress after a reload or a takeover.
  const { data: initialGameState, error: gameStateError } = await supabase
    .from('game_states')
    .select('*')
    .eq('game_id', gameId)
    .single<Database['public']['Tables']['game_states']['Row']>();

  // No state row means the game has not been started yet: it is started from
  // the host dashboard, so that is where the host goes. This is an answer, not a
  // blip, so the redirect stays.
  if (gameStateError?.code === NO_ROWS_RETURNED) {
    redirect('/host');
  }
  if (gameStateError || !initialGameState) {
    void reportError({ scope: 'host-game-page' }, gameStateError ?? new Error('Game state read returned no row and no error'));
    return <LoadErrorScreen retryHref={retryHref} />;
  }

  // First game controls whether the pre-game briefing shows the house rules.
  // Last game controls the wording of the post-win buttons: on the final game
  // there is no next game to move to, so calling it "Move to Next Game" tells
  // the host the button is not for them and leaves the game running for ever.
  const { data: gameIndexes } = await supabase
    .from('games')
    .select('game_index')
    .eq('session_id', sessionId)
    .order('game_index', { ascending: true })
    .returns<{ game_index: number }[]>();

  const indexes = gameIndexes ?? [];
  const isFirstGameOfSession = indexes.length > 0 && game.game_index === indexes[0].game_index;
  const isLastGameOfSession =
    indexes.length > 0 && game.game_index === indexes[indexes.length - 1].game_index;

  // The header's status line: "Game 2 · Blue book". The colour word is there
  // as well as the dot, and is left out rather than shown as "Unknown colour".
  const colourName = getColourName(game.background_colour ?? '');
  const gameStatusLine = [
    `Game ${game.game_index}`,
    colourName === 'Unknown colour' ? null : `${colourName} book`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="min-h-screen-safe bg-anchor-green-deep text-anchor-cream-text">
      <HostHeader title={session.name} backHref="/host">
        <HostHeaderGameStatus bookColour={game.background_colour ?? 'transparent'}>
          {gameStatusLine}
        </HostHeaderGameStatus>
      </HostHeader>

      <GameControl
        sessionId={sessionId}
        gameId={gameId}
        game={game}
        initialGameState={initialGameState}
        currentUserId={user.id}
        currentUserRole={profile?.role || 'host'}
        isFirstGameOfSession={isFirstGameOfSession}
        isLastGameOfSession={isLastGameOfSession}
        sessionName={session.name}
      />
    </div>
  );
}

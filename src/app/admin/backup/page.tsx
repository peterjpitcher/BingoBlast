// src/app/admin/backup/page.tsx
import { createClient } from '@/utils/supabase/server';
import { Database } from '@/types/database';
import { redirect } from 'next/navigation';
import { formatDateInLondon } from '@/lib/dates';
import { Card } from '@/components/ui/card';
import { Kicker } from '@/components/ui/kicker';

type GameWithGameState = Database['public']['Tables']['games']['Row'] & {
  game_states: Pick<Database['public']['Tables']['game_states']['Row'], 'number_sequence'> | null;
  sessions: Pick<Database['public']['Tables']['sessions']['Row'], 'name' | 'start_date'> | null;
};

export default async function AdminBackupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: Database['public']['Tables']['profiles']['Row']['role'] }>();

  if (profile?.role !== 'admin') {
    redirect('/host');
  }

  // Fetch all games with their number sequence and associated session name.
  // The sessions embed must name its foreign key: games and sessions are joined
  // twice (games.session_id and sessions.active_game_id), and PostgREST refuses
  // an unhinted embed between them as ambiguous, which left this page showing
  // only its error state.
  const { data: games, error } = await supabase
    .from('games')
    .select(`
      id,
      game_index,
      name,
      game_states:game_states (number_sequence),
      sessions:sessions!games_session_id_fkey (name, start_date)
    `)
    // Order by session date (latest first). This has to be the related-column
    // form: `foreignTable: 'sessions'` sorts the rows inside the embed, which
    // is a no-op for a single session and left the list in game_index order.
    .order('sessions(start_date)', { ascending: false })
    .order('session_id', { ascending: true }) // Keep two sessions on one date apart
    .order('game_index', { ascending: true }); // Order by game index within a session


  // The page header, shared by the page and its error state.
  const pageHeader = (
    <div className="flex flex-col gap-1.5">
      <Kicker>Admin</Kicker>
      <h1 className="text-[44px] leading-none text-anchor-cream-text">Backup call sheets</h1>
      <p className="max-w-[70ch] text-base text-anchor-sage">
        The number sequence drawn for each game, in calling order.
      </p>
    </div>
  );

  if (error) {
    console.error("Error fetching games for backup:", error.message);
    return (
      <>
        {pageHeader}
        <Card>
          <p className="px-5 py-8 text-sm text-anchor-danger-text">Error loading backup data.</p>
        </Card>
      </>
    );
  }

  const gamesData: GameWithGameState[] = (games || []) as GameWithGameState[];

  // The admin layout draws the header, the footer and the page container.
  return (
    <>
      {pageHeader}

      {gamesData.length === 0 ? (
        <Card>
          <p className="px-5 py-8 text-[15px] text-anchor-sage">No games found with a generated number sequence.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {gamesData.map((game) => (
            <Card key={game.id} className="flex flex-col gap-4 p-5">
              <div className="flex flex-col gap-1.5">
                <Kicker className="text-[11px]">
                  {game.sessions?.name} · {formatDateInLondon(game.sessions?.start_date)}
                </Kicker>
                <h2 className="text-[26px] leading-none text-anchor-cream-text">
                  Game {game.game_index}: {game.name}
                </h2>
              </div>
              {game.game_states?.number_sequence ? (
                <div className="flex flex-wrap gap-2">
                  {game.game_states.number_sequence.map((num, idx) => (
                    <span
                      key={idx}
                      className="grid h-11 min-w-11 place-items-center rounded-card border border-line bg-anchor-green-raised px-2 text-lg font-semibold tabular-nums"
                    >
                      {num}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[15px] text-anchor-sage">No number sequence generated for this game yet.</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

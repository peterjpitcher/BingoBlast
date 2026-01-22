// src/app/admin/backup/page.tsx
import { createClient } from '@/utils/supabase/server';
import { Database } from '@/types/database';
import { redirect } from 'next/navigation';

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

  // Fetch all games with their number sequence and associated session name
  const { data: games, error } = await supabase
    .from('games')
    .select(`
      id,
      game_index,
      name,
      game_states:game_states (number_sequence),
      sessions:sessions (name, start_date)
    `)
    .order('game_index', { ascending: true }) // Order by game index within a session
    .order('sessions.start_date', { ascending: false }); // Order by session date (latest first)


  if (error) {
    console.error("Error fetching games for backup:", error.message);
    return <p className="text-red-500">Error loading backup data.</p>;
  }

  const gamesData: GameWithGameState[] = (games || []) as GameWithGameState[];

  return (
    <div className="min-h-screen-safe bg-slate-950 text-white p-4">
      <h1 className="text-2xl font-bold mb-6">Backup Call Sheets</h1>
      
      {gamesData.length === 0 ? (
        <p className="text-slate-400">No games found with a generated number sequence.</p>
      ) : (
        <div className="space-y-8">
          {gamesData.map((game) => (
            <div key={game.id} className="bg-slate-900 p-6 rounded-lg shadow-lg border border-slate-800">
              <h2 className="text-xl font-semibold mb-2">
                Session: {game.sessions?.name} ({(new Date(game.sessions?.start_date || '')).toLocaleDateString()}) - Game {game.game_index}: {game.name}
              </h2>
              {game.game_states?.number_sequence ? (
                <div className="flex flex-wrap gap-2 text-lg font-mono">
                  {game.game_states.number_sequence.map((num, idx) => (
                    <span key={idx} className="bg-slate-800 text-white px-3 py-1 rounded-md">
                      {num}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500 italic">No number sequence generated for this game yet.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

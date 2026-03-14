# CLAUDE.md — BingoBlast

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions.

## Quick Profile

- **Framework**: Next.js 16.1, React 19.2
- **Test runner**: Node.js native test runner (see `npm test`)
- **Database**: Supabase (PostgreSQL + RLS)
- **Key integrations**: QR codes (qrcode.react), Video player (react-player), No-sleep library (prevent screen dimming), Bingo game logic
- **Size**: ~43 files in src/

## Commands

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint check
npm test                 # Node.js native test runner (node --test --import tsx)
```

Note: Uses native Node.js test runner (no Jest/Vitest). Tests are minimal.

## Architecture

**Route Structure**: App Router optimized for mobile bingo gameplay. Key sections:
- `/` — Bingo lobby and game selection
- `/game/[id]` — Live bingo game (real-time card marking)
- `/admin` — Host view (manage games, call numbers)
- `/api/` — Real-time game state and number calling

**Auth**: Supabase Auth optional (guest mode supported). Players can join without creating account. Hosts use Supabase Auth.

**Database**: Supabase PostgreSQL. Minimal schema: games, cards, called_numbers, scores.

**Key Integrations**:
- **QR Codes**: Share game codes and join links via QR
- **react-player**: Optional video/audio for game theme or number announcements
- **nosleep.js**: Prevent device screen from dimming during gameplay
- **Real-time**: Supabase Realtime or polling for number updates

**Data Flow**: Host creates game → players join via code/QR → host calls numbers → player cards update in real-time → first player to complete card wins.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/` | TypeScript definitions (game, card, player, number) |
| `src/lib/` | Bingo logic, game state, validation |
| `src/app/` | Next.js routes (lobby, game, admin) |
| `src/components/` | Bingo card, number announcer, leaderboard |
| `src/hooks/` | Custom hooks (useGameState, useCard) |
| `src/utils/` | Utilities (QR generation, card generation, scoring) |
| `src/proxy.ts` | Supabase client initialization |
| `supabase/migrations/` | Database schema (games, cards, numbers) |

## Environment Variables

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `SETUP_SECRET` | Secret key for admin setup endpoint (prevent unauthorized game creation) |

## Project-Specific Rules / Gotchas

### Game Flow
1. **Host creates game**: Game ID generated, empty card deck created
2. **Players join**: Scan QR code or enter code → bingo card generated (randomized 75-ball or 90-ball UK)
3. **Host calls numbers**: Host interface shows random number generator → number broadcast to all players in real-time
4. **Player marks card**: Tap number on card to mark (tap again to unmark)
5. **Win detection**: System detects horizontal, vertical, diagonal line (regular) or all squares (coverall)
6. **Winner confirmation**: Host confirms winner → game ends → leaderboard shown

### Bingo Card Generation
- Standard 75-ball (5x5) or 90-ball (UK) format
- Numbers randomly distributed (no duplicates on single card)
- Each column has range: B (1-15), I (16-30), N (31-45), G (46-60), O (61-75)
- Center square always FREE in 75-ball
- Store card state (marked/unmarked squares) in Supabase or browser state

### Win Detection
- Check for: horizontal line, vertical line, diagonal, four corners, coverall
- Validate win before awarding points
- Support multiple winners (tie scenario)
- Log timestamp of win for leaderboard sorting

### Real-Time Updates
- Use Supabase Realtime subscriptions or polling (2-3 second intervals)
- Broadcast number call to all players in game
- Update called_numbers table with timestamp
- Cards update optimistically (tap to mark, sync with server)

### QR Codes
- Generate QR for game join URL: `yourdomain.com/game/[game-id]?join=true`
- Display QR on host screen for players to scan
- Also provide text code (e.g., "BINGO123") for manual entry
- QR size: 200x200px or larger on mobile

### Mobile Optimization
- Full-screen game view (no navigation bar during play)
- Landscape and portrait orientation support
- Large touch targets for number marking (min 40x40px)
- No hover states (use active/focus instead)

### Screen Keep-Awake
- Use `nosleep.js` library to prevent screen dimming
- Enable on game start: `enable()` when player joins
- Disable on game end or pause
- Graceful fallback if feature not supported

### react-player Integration
- Optional audio/video for number announcements
- Mute by default (user-controlled)
- Support YouTube, MP3, or local video URLs
- Stream or embed announcements (e.g., "Number 47: Three and four, 44")

### Game State Management
- Minimal server state (just called numbers)
- Card state can be client-side (localStorage) or server-side (Supabase)
- Host view needs list of all cards for current game
- Player count and join status tracked in Supabase

### Database Schema
- `games`: id, host_id, code, started_at, ended_at, winner_id, game_type (75-ball/90-ball)
- `cards`: id, game_id, player_id, numbers (JSON array), marked (JSON boolean array), created_at
- `called_numbers`: id, game_id, number, called_at
- `leaderboard`: id, game_id, player_id, position, marked_at (win timestamp)

### Security
- Validate game code before allowing join
- RLS: players can only see own card and public game info
- Host authentication required to call numbers
- Rate limit number calling (prevent spam)
- SETUP_SECRET required for admin endpoints (set in env, validate on server)

### Performance
- Load only current game data (not all games)
- Lazy-load leaderboard/results
- Preload next game when host presses "continue"
- QR generation fast (< 100ms)
- Keep game state compact (avoid sending full card to players repeatedly)

### Guest Mode
- Allow players to join without auth (optional)
- Store player name as session data
- Use session ID as player_id (not user_id)
- Clear session data when game ends or browser closes

### Accessibility
- Bingo card has clear grid layout
- Number marking toggles (not keyboard-only)
- Color not sole indicator (use checkmarks)
- Win announcements audible (if using react-player)
- Focus visible on all buttons

### Testing
- Native Node.js test runner (no Jest/Vitest)
- Test card generation logic (randomness, no duplicates)
- Test win detection (all patterns)
- Test QR code generation
- Minimal test coverage (business logic only)

### Deployment
- Environment variables required: Supabase URL/keys, SETUP_SECRET
- Enable Supabase Realtime for live number updates
- Consider CDN caching for static assets (QR generators, player avatars)
- Monitor real-time connection performance

### Common Patterns
- Game creation: host enters name → game_id generated → display QR → wait for players
- Player join: scan QR or enter code → card generated → card displayed
- Game play: host calls number → players mark cards → check for wins → leaderboard
- Multiple games: support multiple concurrent games with different hosts

### Gotchas
- QR code URL must include full domain (not relative path)
- Card marking state must sync with server (prevent cheating)
- Win detection must be fast (<500ms) to feel responsive
- Nosleep.js doesn't work on all devices/browsers (graceful fallback)
- Real-time updates may lag on poor network (show loading indicator)
- Bingo card numbers are randomized per card (standard behavior)

### Guest Session Management
- Use anonymous Supabase auth or custom session ID
- Store in `player_sessions` table with expiry
- Clean up expired sessions periodically
- Allow guest to convert to registered account after game

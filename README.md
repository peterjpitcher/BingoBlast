# Anchor Bingo Web App

A 90-ball bingo control system for The Anchor pub, with three interfaces:

- **Admin** (`/admin`) — staff manage sessions, games, prizes, and the snowball jackpot.
- **Host** (`/host`) — staff run the live game: call numbers, validate winners, advance stages.
- **Display** (`/display`) — public big-screen TV view, plus a guest-friendly mobile follower screen at `/player/[sessionId]`.

This app does **not** generate digital cards or mark squares. Players use physical paper bingo books at the table.

## Documentation

The full Product Requirements Document (PRD) is available in [docs/PRD.md](docs/PRD.md). Architecture references live in [docs/architecture/](docs/architecture/).

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Setup:**
   Copy `.env.example` to `.env.local` and fill in your Supabase credentials and `SETUP_SECRET`. For production deployments, also set `NEXT_PUBLIC_SITE_URL` to your public origin (e.g. `https://bingo.theanchor.pub`) so the display QR builds an absolute join URL.
   ```bash
   cp .env.example .env.local
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

4. **Open the app:**
   Visit [http://localhost:3000](http://localhost:3000) for the landing page with links to the three main interfaces:
   - **Admin:** `/admin`
   - **Host:** `/host`
   - **Display:** `/display`

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, local UI primitives in `src/components/ui/`
- **Backend / DB:** Supabase (Auth, Postgres + RLS, Realtime)
- **Other:** `qrcode.react` (display QR for follower view), `nosleep.js` (screen-keep-awake on host/display), `zod` (server-action validation)

## Project Structure

- `src/app/admin` — Admin interface pages.
- `src/app/host` — Host controller interface pages.
- `src/app/display` — Public TV display interface pages.
- `src/app/player` — Public mobile follower interface.
- `src/app/login` — Staff login (invite-only — no public sign-up).
- `src/app/api/setup` — `SETUP_SECRET`-gated bootstrap endpoint.
- `src/lib` — Shared utilities (game-state versioning, prize validation, win stages, connection health, etc.).
- `src/hooks` — `use-connection-health`, `wake-lock`.
- `src/components` — Shared UI including `connection-banner` and `ui/*` primitives.
- `src/utils/supabase` — Supabase client variants (browser, server, middleware-style session refresh).
- `src/proxy.ts` — Next.js middleware export. Matcher is scoped to `/admin/:path*`, `/host/:path*`, and `/login` only.
- `supabase/migrations` — DB schema (sessions, games, game_states + public mirror, winners, snowball pots).

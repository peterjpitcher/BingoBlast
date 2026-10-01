# The Anchor brand overhaul: implementation plan

**Goal:** restyle every surface of the app to The Anchor brand (design handoff of 1 Oct 2026): deep green cinematic surfaces, cream text, gold accents, DM Serif Display headlines, Outfit body. Presentation only. Business logic, routes, server actions, data model and the claim flow do not change.

**Branch:** `feat/anchor-brand-overhaul`. No migration. Not pushed, merged or deployed without the owner's yes.

**Design source:** the handoff folder (kept outside the repo; path given in each brief). `README.md` in that folder is the written spec, the `.dc.html` files are the pixel references.

**Complexity:** 5 (XL, about 40 files). The workspace rule asks for several independently deployable PRs. This one ships as one branch on purpose: every screen shares the one token change, so a part release would put two brands on the same night (a new TV with an old host screen). It is split into one commit per surface instead, each passing the gate.

## Waves

- [x] **Wave 0, foundations** (orchestrator): fonts, tokens, Tailwind names, primitives, page shell, host header, landing, sign in, pending, banners.
- [x] **Wave 1, in parallel, one agent each, no shared files:**
  - [x] A. Host console (`/host`)
  - [x] B. Host live game (`/host/[sessionId]/[gameId]`)
  - [x] C. TV display (`/display`, `/display/[sessionId]`) and the shared claim panel
  - [x] D. Phone follower (`/play`, `/player/[sessionId]`)
  - [x] E. Admin back office (`/admin/*`)
- [x] **Wave 2, orchestrator:** remove the temporary compatibility props, sweep for old palette classes, full gate (`lint`, `typecheck`, `test`, `test:utc`, `build`), browser check of every screen and state on a local Supabase stack with `scripts/check-render.js`, update `CLAUDE.md`.

## Foundations (what wave 1 builds on)

Tokens live in `src/app/globals.css` (`:root`) and are named in `tailwind.config.ts`. Components use the names, never a hex.

| Need | Class |
|---|---|
| Page | `bg-anchor-green-deep` (the body already has it) |
| Card, sheet, dialog surface | `bg-anchor-green-card` |
| Raised row, chip, tile on a card | `bg-anchor-green-raised` |
| Body text | `text-anchor-cream-text` (the body default) |
| Muted text | `text-anchor-sage` |
| Accent text, icons | `text-anchor-gold-bright` |
| Text on a gold fill | `text-anchor-charcoal` |
| Primary fill | `bg-anchor-gold`, hover `bg-anchor-gold-dark` |
| Success text on dark | `text-anchor-success-text`; tick fill `bg-anchor-success` |
| Danger fill or border | `bg-anchor-danger`, `border-anchor-danger`; danger text on dark `text-anchor-danger-text` |
| Hairlines | `border-line` (rows), `border-line-strong` (emphasis, inputs), `border-line-gold` (cards, bars) |
| Scrim | `bg-scrim backdrop-blur-[4px]` (phones); the TV uses `bg-anchor-green-deep/[0.94] backdrop-blur-md` |
| Radii | `rounded-card` (3px), `rounded-input` (6px), `rounded-full`. Nothing else. |
| Shadows | `shadow-gold`, `shadow-lift`, `shadow-sheet` |
| Fonts | body is Outfit by default (`font-sans`); every `h1` to `h6` is DM Serif Display automatically; `font-display` for serif on other elements (prize figures, counts); `font-script` for the brand line |
| Motion | `animate-fade-up` (400ms), `animate-fade-in` (200ms), `animate-sheet-up` (300ms), `animate-ball-in` (400ms), `ease-anchor` |
| Kicker | `<Kicker>` or the `kicker` class |
| Grain | `<Grain />` in a positioned parent (TV, landing, admin; not the host's phone screens) |

Primitives in `src/components/ui`:

- `Button` (`button.tsx`): `variant` `primary | outline | ghost`, `size` `sm | md | lg | xl`, `block`, `tone="quiet"` (sage ghost for Void, Delete, Sign out), `isLoading`. `buttonClass({...})` gives the same classes to a `Link`. `xl` is the host's 76px main action.
- `Card` (`card.tsx`): `accent` (gold top rule), `hover` (link cards). `cardClass({...})` for non-div elements. `CardHeader`, `CardTitle`, `CardContent`, `CardFooter` remain.
- `Badge` (`badge.tsx`): `variant` `outline | success | gold | danger`, `dot`.
- `Kicker` (`kicker.tsx`), `Input` plus `fieldClass` and `fieldLabelClass` (`input.tsx`, for selects and textareas too).
- `Modal` (`modal.tsx`): centred dialog; new optional `kicker` and `accent`. `Sheet` (`sheet.tsx`): bottom sheet with `title`, `kicker`, `description`, `header` (custom top), `footer`, `size` `tall | auto`.
- `BingoBall` and `NumberChip` (`bingo-ball.tsx`): sized by `size` (px or any CSS length), `numberScale`, `ring`, `badge` `tick | cross`, `surface`.
- `AnchorLogo` and `Grain` (`logo.tsx`).
- `HostHeader` and `HostHeaderGameStatus` (`src/components/host/host-header.tsx`): the sticky phone header.
- `CopyrightLine` (`src/components/copyright-line.tsx`), `BrandBackdrop` (`src/components/brand-backdrop.tsx`).

## Decisions and assumptions

- **Book colour is a band, not a flood** (the design's recommended default): 22px under the TV's top bar plus a labelled chip, 8px under the phone header. Text never sits on the book colour, which retires the white-book contrast trap.
- **Kitchen line** comes from `KITCHEN_OPEN_UNTIL` in `src/lib/venue-links.ts`, never typed into a component.
- **`lucide-react` was not a dependency** (the handoff says it was). Added at 1.49.0, ISC licence.
- **Danger text on a dark surface is lightened** (`--anchor-danger-text`, #e57368). The brand danger (#b1372f) is about 2.4:1 on a dark card, under the 3:1 floor `scripts/check-render.js` enforces. Fills and borders keep the brand value.
- **Buttons may wrap** on a narrow phone rather than overflow (the design system sets `nowrap`).
- **The landing, sign-in and admin footers** carry the copyright line; the old global footer and the landing header are gone, as the designs show none.
- **The copyright year** is the London year at render, not a typed 2026.
- **The phone status bar padding** (54px in the prototypes) is `env(safe-area-inset-top)` plus the design's own 10 to 12px, since the prototype's figure is the iPhone frame.

- **Where the handoff's README and its prototype disagree, the prototype wins**, as it is what was looked at and signed off. The host console's game rows are the case in point: round number discs and the labels Resume, Start, Re-open, Locked and Finished (the README says Open, Review and Waiting, but "Review" re-opens a finished game).
- **Copy that follows the design:** "Game 2 of 10 · Blue book" (was a comma), "Last number called · 22" (was a colon), and the win headline in sentence case through `formatWinHeadline()` in `src/lib/win-headline.ts`, since the database writes it in capitals.
- **Kept from the old screens where the design is silent:** every dialog, error, empty state and warning, restyled in the same language. The host's "Given" badge can still be tapped to undo a prize marked by mistake.
- **TV sizes held to the floors rather than the drawing** where they clash: the game and colour line is 44px (the design draws 36px, under the key-information floor), event titles are 70px (drawn at 96px) so real two-line titles fit at 720p, and claim and win balls step down by row so a Full House fits.
- **The admin layout makes one new read** (is a session running, for the header badge) plus the signed-in email. A failed read leaves the badge or email out and never redirects.

## Results

- **Gate (1 Oct 2026):** `npm run lint` clean, `npm run typecheck` clean, `npm test` and `npm run test:utc` 457 passed and 1 skipped, the same under Node 22 (the CI version), `npm run build` clean.
- **Logic check:** hooks, effects and their dependency arrays, awaited calls, setters and handlers were counted before and after in the seven largest files. They match, apart from the winners sheet's duplicate Close button (removed) and the last-ball question, which moved from a stacked dialog into the claim sheet.
- **Browser check on a local Supabase stack** (a seeded night, with a stand-in events feed), at 375x812 for the phones, 1920x1080 and 1280x720 for the TV and 1280 wide for admin:
  - Landing, sign in (including a refused sign-in) and pending.
  - Host console: sessions list, expanded session, a running night, locked and finished rows, End the night.
  - Host live game: briefing, calling, claim sheet (called, tapped, not called, last ball), not a valid claim, last number missing, valid claim, record winner, winner recorded, stage won, winners and prizes, break, end game (standard and snowball), a finished game, the snowball strip, and a snowball Full House with the eligible or not eligible choice (no default; Confirm stays off until one is chosen).
  - TV: follow along, events, house rules, stage preview, calling, snowball, claim check (a Line and a fifteen-ball Full House), win (a Line and the snowball jackpot), break and its event slides, end of night, idle loop. `scripts/check-render.js` reported nothing at either size.
  - Phone: calling, win, snowball, break with events, end of night, the rules and called-numbers sheets, and `/play` with nothing running. `check-render` flagged only the design's own 11 to 13px labels.
  - Admin: sessions, session detail with a winner, snowball pots, winners, and the layout at phone width.
- **Not seen in a browser:** view-only and takeover, a voided winner row, the manual snowball win, the admin dialogs' submit paths, and the TV's review invitation (off unless `NEXT_PUBLIC_REVIEW_INVITE_ENABLED` is set).
- **Found, not fixed here:** the admin Backup page's query is ambiguous and always fails (production has the same two foreign keys); and `getColourName()` calls the production lilac and peach books "White" and the orange book "Yellow".

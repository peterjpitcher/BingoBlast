// src/components/display/claim-panel.tsx
//
// The live claim on the TV and the phones (spec 5.2): each claimed number in
// tap order, ticked if it has been called and crossed if not, the last called
// ball ringed, and the server's verdict. The state comes from
// getClaimPanelState (src/lib/claim-panel.ts); this file only draws it.
//
// Ticks and crosses are shapes with labels, never colour alone.
//
// The phone variant draws no card: the phone screen wraps it in its own. The
// TV variant brings its own padding, which tightens as the rows of balls grow,
// and sits in a card drawn by the TV screen.
import React from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClaimBall, ClaimPanelState } from '@/lib/claim-panel';
import { BingoBall } from '@/components/ui/bingo-ball';
import { Kicker } from '@/components/ui/kicker';
import { TV_KICKER_CLASS, tvText } from './tv-text';

export type ClaimPanelVariant = 'tv' | 'phone';

// At most five balls a row, so a Full House is three rows of five.
const MAX_COLUMNS = 5;
const MAX_ROWS = 3;

/** How many rows the balls take: 1 for a Line, 2 for Two Lines, 3 for a Full House. */
function rowsFor(ballCount: number): number {
  return Math.min(MAX_ROWS, Math.max(1, Math.ceil(ballCount / MAX_COLUMNS)));
}

// The TV's ball shrinks as the rows grow, so three rows still fit between the
// top bar and the footer: 156px, 140px and 121px at 1920x1080; 104px, 94px and
// 80px (the floor) at 1280x720. The gaps shrink with it.
const TV_BALL_SIZE = ['clamp(100px, 14.4vh, 220px)', 'clamp(90px, 13vh, 200px)', 'clamp(80px, 11.2vh, 170px)'];
const TV_BALL_GAP = ['clamp(18px, 2.6vh, 40px)', 'clamp(15px, 2.2vh, 34px)', 'clamp(11px, 1.85vh, 28px)'];
// A phone ball is 56px. On a phone narrower than about 380px it gives a
// little, down to 44px, so five still sit in a row: the phone's claim and win
// cards leave 66px less than the screen's width (page gutter, border and card
// padding each side; 68px here for a little slack), and four gaps take 2rem.
const PHONE_BALL_GAP = '0.5rem';
const PHONE_BALL_SIZE = `clamp(2.75rem, calc((100vw - 68px - ${MAX_COLUMNS - 1} * ${PHONE_BALL_GAP}) / ${MAX_COLUMNS}), 3.5rem)`;

interface BallGeometry {
  /** The numeral, the border and the badge, as shares of the diameter. */
  numberScale: number;
  borderScale: number;
  badgeScale: number;
  /** How far the badge sits outside the ball's top right corner. */
  badgeOffset: number;
  badgeBorder: string;
  /** The gold ring on the last number called. */
  ring: string;
}

const GEOMETRY: Record<ClaimPanelVariant, BallGeometry> = {
  // 156px ball: 72px numeral, 7px border, 56px badge with a 3px border, 8px ring.
  tv: {
    numberScale: 0.46,
    borderScale: 0.045,
    badgeScale: 0.36,
    badgeOffset: 0.064,
    badgeBorder: 'max(2px, calc(var(--claim-ball) * 0.02))',
    ring: 'clamp(5px, 0.74vh, 8px)',
  },
  // 56px ball: 24px numeral, 3px border, 22px badge with a 2px border, 4px ring.
  phone: {
    numberScale: 0.43,
    borderScale: 0.035,
    badgeScale: 0.39,
    badgeOffset: 0.09,
    badgeBorder: '2px',
    ring: '4px',
  },
};

function Ball({ ball, variant }: { ball: ClaimBall; variant: ClaimPanelVariant }) {
  const geometry = GEOMETRY[variant];
  const Icon = ball.called ? Check : X;
  return (
    <li className="relative flex shrink-0">
      <BingoBall
        number={ball.n}
        size="var(--claim-ball)"
        numberScale={geometry.numberScale}
        borderScale={geometry.borderScale}
        ring={ball.isLast ? geometry.ring : undefined}
        className={ball.called ? undefined : 'border-anchor-danger'}
      />
      {ball.isLast && <span className="sr-only">, the last number called</span>}
      {/* The badge's border takes the colour of the surface behind the balls:
          the card by default; a parent on the deep green sets --claim-surface. */}
      <span
        className={cn(
          'absolute flex items-center justify-center rounded-full border-solid border-[color:var(--claim-surface,var(--anchor-green-card))] text-white',
          ball.called ? 'bg-anchor-success' : 'bg-anchor-danger'
        )}
        style={{
          width: `calc(var(--claim-ball) * ${geometry.badgeScale})`,
          height: `calc(var(--claim-ball) * ${geometry.badgeScale})`,
          right: `calc(var(--claim-ball) * -${geometry.badgeOffset})`,
          top: `calc(var(--claim-ball) * -${geometry.badgeOffset})`,
          borderWidth: geometry.badgeBorder,
        }}
      >
        <Icon role="img" aria-label={ball.called ? 'Called' : 'Not called'} className="h-[60%] w-[60%]" strokeWidth={3.5} />
      </span>
    </li>
  );
}

/** The claimed balls, in tap order, at most five a row. */
export function ClaimBalls({ balls, variant }: { balls: ReadonlyArray<ClaimBall>; variant: ClaimPanelVariant }) {
  if (balls.length === 0) return null;
  const row = rowsFor(balls.length) - 1;
  const size = variant === 'tv' ? TV_BALL_SIZE[row] : PHONE_BALL_SIZE;
  const gap = variant === 'tv' ? TV_BALL_GAP[row] : PHONE_BALL_GAP;
  return (
    <ol
      aria-label="Claimed numbers, in the order the caller read them"
      className="mx-auto flex w-fit flex-wrap justify-start"
      style={{
        ['--claim-ball' as string]: size,
        gap,
        // Five balls and four gaps, plus a pixel so rounding can never push
        // the fifth ball onto the next row.
        maxWidth: `calc(${MAX_COLUMNS} * ${size} + ${MAX_COLUMNS - 1} * ${gap} + 1px)`,
      } as React.CSSProperties}
    >
      {balls.map((ball, index) => (
        <Ball key={`${ball.n}-${index}`} ball={ball} variant={variant} />
      ))}
    </ol>
  );
}

const VERDICT_KINDS = new Set<ClaimPanelState['kind']>(['valid', 'invalid', 'late']);

// The TV panel's own padding and spacing, by rows of balls. One row is the
// design's 48px by 56px with 32px between the parts at 1080p; three rows pull
// in so the whole claim fits the main area at 1280x720 (see display-ui.tsx).
const TV_PANEL_SPACING = [
  'gap-[clamp(20px,3vh,32px)] px-[clamp(24px,2.9vw,56px)] py-[clamp(30px,4.4vh,48px)]',
  'gap-[clamp(18px,2.6vh,28px)] px-[clamp(24px,2.9vw,56px)] py-[clamp(26px,3.7vh,40px)]',
  'gap-[clamp(10px,1.7vh,24px)] px-[clamp(24px,2.9vw,56px)] py-[clamp(16px,2.6vh,28px)]',
];

interface ClaimPanelProps {
  state: ClaimPanelState;
  variant: ClaimPanelVariant;
}

/** The whole claim: headline, balls, verdict or progress, and the last number. */
export function ClaimPanel({ state, variant }: ClaimPanelProps) {
  const isVerdict = VERDICT_KINDS.has(state.kind);

  if (variant === 'phone') {
    return (
      <div className="space-y-3 text-center" role="status" aria-live="polite">
        <h2 className="text-[26px] leading-[1.05] text-anchor-cream-text">{state.headline}</h2>
        <ClaimBalls balls={state.balls} variant="phone" />
        <p className={cn('font-semibold text-anchor-cream-text', isVerdict ? 'text-lg' : 'text-base')}>{state.detail}</p>
        {state.lastNumberLine && <Kicker as="p">{state.lastNumberLine}</Kicker>}
      </div>
    );
  }

  const row = rowsFor(state.balls.length) - 1;
  return (
    <div
      className={cn('flex w-full flex-col items-center text-center text-anchor-cream-text', TV_PANEL_SPACING[row])}
      role="status"
      aria-live="polite"
    >
      {/* The design's 84px headline; a size down over three rows of balls. */}
      <h1 className={tvText(row === MAX_ROWS - 1 ? 'xl' : '2xl', 'leading-[1.05]')}>{state.headline}</h1>
      <ClaimBalls balls={state.balls} variant="tv" />
      {/* Progress and verdict alike are key information. */}
      <p className={tvText('base', 'max-w-[90%] font-semibold')}>{state.detail}</p>
      {state.lastNumberLine && <p className={TV_KICKER_CLASS}>{state.lastNumberLine}</p>}
    </div>
  );
}

// src/components/display/claim-panel.tsx
//
// The live claim on the TV and the phones (spec 5.2): each claimed number in
// tap order, ticked if it has been called and crossed if not, the last called
// ball ringed, and the server's verdict. The state comes from
// getClaimPanelState (src/lib/claim-panel.ts); this file only draws it.
//
// Ticks and crosses are shapes with labels, never colour alone.
import React from 'react';
import { cn } from '@/lib/utils';
import type { ClaimBall, ClaimPanelState } from '@/lib/claim-panel';
import { TV_TEXT_BODY, TV_TEXT_KEY } from './tv-text';

export type ClaimPanelVariant = 'tv' | 'phone';

// At most five balls a row, so a Full House is three rows of five. On the TV a
// ball is at least 120px at 1920x1080 (11.2vh) and 80px at 1280x720 (the floor).
const BALL_SIZE: Record<ClaimPanelVariant, string> = {
  tv: 'clamp(80px, 11.2vh, 200px)',
  phone: '3.5rem',
};
const BALL_GAP: Record<ClaimPanelVariant, string> = {
  tv: 'clamp(10px, 1.5vh, 28px)',
  phone: '0.5rem',
};
const MAX_COLUMNS = 5;

function TickIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label="Called" className="h-full w-full">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label="Not called" className="h-full w-full">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

function Ball({ ball, variant }: { ball: ClaimBall; variant: ClaimPanelVariant }) {
  return (
    <li
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-full font-bold leading-none text-white',
        ball.called ? 'bg-[#005131] border-white' : 'bg-[#005131] border-red-500',
        variant === 'tv' ? 'border-[5px]' : 'border-[3px]',
        ball.isLast && 'ring-[6px] ring-[#f3d59d]'
      )}
      style={{
        width: 'var(--claim-ball)',
        height: 'var(--claim-ball)',
        fontSize: 'calc(var(--claim-ball) * 0.44)',
        fontVariantNumeric: 'tabular-nums lining-nums',
      }}
    >
      <span className={cn(!ball.called && 'opacity-80')}>{ball.n}</span>
      {ball.isLast && <span className="sr-only">, the last number called</span>}
      <span
        className={cn(
          'absolute -right-[6%] -top-[6%] flex items-center justify-center rounded-full border-2 border-white p-[5%] text-white',
          ball.called ? 'bg-green-700' : 'bg-red-600'
        )}
        style={{ width: 'calc(var(--claim-ball) * 0.4)', height: 'calc(var(--claim-ball) * 0.4)' }}
      >
        {ball.called ? <TickIcon /> : <CrossIcon />}
      </span>
    </li>
  );
}

/** The claimed balls, in tap order, at most five a row. */
export function ClaimBalls({ balls, variant }: { balls: ReadonlyArray<ClaimBall>; variant: ClaimPanelVariant }) {
  if (balls.length === 0) return null;
  const size = BALL_SIZE[variant];
  const gap = BALL_GAP[variant];
  return (
    <ol
      aria-label="Claimed numbers, in the order the caller read them"
      className="mx-auto flex w-fit flex-wrap justify-start"
      style={{
        ['--claim-ball' as string]: size,
        gap,
        maxWidth: `calc(${MAX_COLUMNS} * ${size} + ${MAX_COLUMNS - 1} * ${gap})`,
      } as React.CSSProperties}
    >
      {balls.map((ball, index) => (
        <Ball key={`${ball.n}-${index}`} ball={ball} variant={variant} />
      ))}
    </ol>
  );
}

const VERDICT_KINDS = new Set<ClaimPanelState['kind']>(['valid', 'invalid', 'late']);

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
        <h2 className="text-xl font-bold text-white">{state.headline}</h2>
        <ClaimBalls balls={state.balls} variant="phone" />
        <p className={cn('text-white', isVerdict ? 'text-lg font-bold' : 'text-base')}>{state.detail}</p>
        {state.lastNumberLine && <p className="text-base font-semibold text-white">{state.lastNumberLine}</p>}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-[1.6vh] text-center" role="status" aria-live="polite">
      <h1 className={cn(TV_TEXT_KEY, 'font-black uppercase tracking-[0.06em] text-white')}>{state.headline}</h1>
      <ClaimBalls balls={state.balls} variant="tv" />
      <p className={cn(isVerdict ? TV_TEXT_KEY : TV_TEXT_BODY, isVerdict ? 'font-bold' : 'font-semibold', 'max-w-[90%] text-white')}>
        {state.detail}
      </p>
      {state.lastNumberLine && (
        <p className={cn(TV_TEXT_BODY, 'font-bold uppercase tracking-[0.1em] text-[#f3d59d]')}>{state.lastNumberLine}</p>
      )}
    </div>
  );
}

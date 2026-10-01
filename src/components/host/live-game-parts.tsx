import * as React from 'react';
import { Check, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kicker } from '@/components/ui/kicker';
import { cn } from '@/lib/utils';

// Presentational pieces of the host's live game screen. Props in, markup out:
// no data fetching and no state. Everything that decides what the host sees
// stays in game-control.tsx.

interface StatusStripProps {
  icon: LucideIcon;
  /** 'gold' is the loud strip for a break or a claim; 'quiet' states a fact (game completed). */
  tone?: 'gold' | 'quiet';
  children: React.ReactNode;
}

/** The full-width strip under the header: "On break · calling paused", "Checking a claim". */
export function StatusStrip({ icon: Icon, tone = 'gold', children }: StatusStripProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2.5 px-4 py-3 text-center text-sm font-bold uppercase tracking-[0.14em]',
        tone === 'gold'
          ? 'bg-anchor-gold-bright text-anchor-charcoal'
          : 'border-b border-line-gold bg-anchor-green-raised text-anchor-cream-text',
      )}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={2.2} className="shrink-0" />
      <span>{children}</span>
    </div>
  );
}

interface HostAlertProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * An error the host must read: the danger border, a warning mark and
 * role="alert". The mark matters as much as the colour, so an error never
 * reads as one of the gold status strips or notices.
 */
export function HostAlert({ children, className }: HostAlertProps): React.ReactElement {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-card border border-anchor-danger bg-anchor-danger/[0.12] p-3 text-left text-[15px] font-semibold leading-snug text-anchor-cream-text',
        className,
      )}
    >
      <TriangleAlert aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-anchor-danger-text" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">{children}</div>
    </div>
  );
}

interface StatCellProps {
  label: string;
  children: React.ReactNode;
}

/** One cell of the Calls / Playing for / Prize row: a small kicker over its value. */
export function StatCell({ label, children }: StatCellProps): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Kicker className="text-[11px]">{label}</Kicker>
      {children}
    </div>
  );
}

interface VerdictPanelProps {
  /** 'success' for a valid claim, 'danger' for one that is not. */
  tone: 'success' | 'danger';
  title: string;
  /** Replaces the tick or cross disc, for a panel that leads with a number. */
  lead?: React.ReactNode;
  children: React.ReactNode;
}

/** The claim sheet's verdict: a tinted, bordered panel with a mark, a headline, then its text and actions. */
export function VerdictPanel({ tone, title, lead, children }: VerdictPanelProps): React.ReactElement {
  return (
    <div
      className={cn(
        'mt-1 flex flex-col gap-2.5 rounded-card border px-4 py-3.5',
        tone === 'success'
          ? 'border-anchor-success-text bg-anchor-success-text/[0.12]'
          : 'border-anchor-danger bg-anchor-danger/[0.12]',
      )}
    >
      <div className="flex items-center gap-2.5">
        {lead ?? (
          <span
            aria-hidden="true"
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              tone === 'success' ? 'bg-anchor-success-text text-anchor-green-deep' : 'bg-anchor-danger text-white',
            )}
          >
            {tone === 'success' ? <Check size={18} strokeWidth={3} /> : <X size={18} strokeWidth={3} />}
          </span>
        )}
        <h2 className="text-[26px] leading-[1.05] text-anchor-cream-text">{title}</h2>
      </div>
      {children}
    </div>
  );
}

interface PrizeGivenToggleProps {
  given: boolean;
  /** The label while the prize has not been handed over: "Give prize", "Mark given". */
  label: string;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * The prize-given control. Not given, it is the gold button. Given, it shows
 * the green "Given" badge, and the badge is still a button: tapping it puts a
 * prize marked by mistake back to not given.
 */
export function PrizeGivenToggle({ given, label, onToggle, disabled = false, className }: PrizeGivenToggleProps): React.ReactElement {
  if (!given) {
    return (
      <Button variant="primary" size="sm" className={cn('shrink-0', className)} onClick={onToggle} disabled={disabled}>
        {label}
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label="Prize given. Tap to mark it as not given."
      className="flex min-h-11 shrink-0 cursor-pointer items-center rounded-full transition-opacity duration-150 ease-anchor hover:opacity-80 disabled:pointer-events-none disabled:opacity-45"
    >
      <Badge variant="success" dot className="min-h-8 text-[13px]">Given</Badge>
    </button>
  );
}

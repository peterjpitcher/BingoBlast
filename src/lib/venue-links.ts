// src/lib/venue-links.ts
//
// Venue facts shown on the public screens, kept in one place so the copy has a
// named source rather than being typed into a component.

/**
 * When the kitchen stops taking food orders, as shown on the pub TV
 * ("Kitchen Open Until 9pm").
 *
 * Source: the owner, 30 September 2026. Deliberately not read from the
 * management app (spec decision D4). Change it here if the kitchen hours change.
 */
export const KITCHEN_OPEN_UNTIL = '9pm';

/**
 * The review invitation's destination: a short link to the management app's
 * feedback page, with no expiry. Source: spec sections 2 and 5.6.
 */
export const REVIEW_URL = 'https://l.the-anchor.pub/cvf4k7';

/** The website's what's-on page, for the idle TV loop. Source: spec 5.5. */
export const WHATS_ON_URL = 'https://www.the-anchor.pub/whats-on';

/**
 * Whether the TV and phones show the review invitation. Off unless
 * NEXT_PUBLIC_REVIEW_INVITE_ENABLED is exactly 'true' (spec A5: it stays off
 * until the feedback page offers Google to every guest). Read by its literal
 * name so Next.js inlines it into the browser bundle.
 */
export function isReviewInviteEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REVIEW_INVITE_ENABLED === 'true';
}

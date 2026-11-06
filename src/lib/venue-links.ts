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
 * Cash Bingo's own review short link, on the TV's end-of-night "Review us"
 * card and the phone's "Tell us how we did" button. It leads to the
 * management app's feedback page (https://management.orangejelly.co.uk/feedback
 * ?src=review-ask&utm_source=in_game_screen..., checked live 6 November 2026),
 * which offers Google and private feedback equally (management app PR 320),
 * so it is always on. Never a Google review URL: the kit draws no card for
 * anything that is not an https the-anchor.pub link (website docs/SSOT.md
 * section 17). Source: Anchor Nights standard X-2 (Cash Bingo keeps cvf4k7).
 */
export const REVIEW_URL = 'https://l.the-anchor.pub/cvf4k7';

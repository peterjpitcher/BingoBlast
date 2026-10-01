// src/lib/win-headline.ts
//
// The win headline on the TV and the phones. The database writes it in
// capitals ("LINE WINNER!", "FULL HOUSE + SNOWBALL £180!", "BINGO!"), which
// suited the old screens. The brand sets headlines in sentence case, so this
// recases the text for display and leaves the stored value alone.

/** Names that keep their capitals inside a sentence. */
const KEPT_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/\bfull house\b/g, 'Full House'],
  [/\btwo lines\b/g, 'Two Lines'],
];

/**
 * "LINE WINNER!" becomes "Line winner!", and "FULL HOUSE + SNOWBALL £180!"
 * becomes "Full House + snowball £180!". Empty or missing text gives ''.
 */
export function formatWinHeadline(text: string | null | undefined): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '';

  let headline = trimmed.toLowerCase();
  for (const [pattern, name] of KEPT_NAMES) {
    headline = headline.replace(pattern, name);
  }
  return headline.charAt(0).toUpperCase() + headline.slice(1);
}

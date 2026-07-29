// src/lib/number-nicknames.ts
/**
 * Traditional 90 ball bingo calls, as the host says them at The Anchor.
 *
 * Not every number has one: `getNumberNickname` returns null for the rest, and
 * the caller renders nothing rather than a placeholder.
 *
 * Wording is the host's own, so leave it alone unless the host asks. That
 * includes `10: "Andys Den"` with no apostrophe.
 */
export const NUMBER_NICKNAMES: Readonly<Record<number, string>> = {
  1: "Kelly's Eye",
  2: 'One Little Duck',
  3: 'Debbie McGee',
  4: 'Knock at the Door',
  5: 'Man Alive',
  6: 'Half Dozen',
  7: 'Lucky For Some',
  8: 'Garden Gate',
  9: "Doctor's Orders",
  10: 'Andys Den',
  11: 'Legs Eleven',
  12: 'One Dozen',
  13: 'Unlucky For Some',
  14: 'Valentines Day',
  15: 'Young And Keen',
  16: 'Sweet Sixteen',
  17: 'Dancing Queen',
  20: 'Blind Twenty',
  22: 'Two Little Ducks',
  25: 'Duck And Dive',
  26: 'Pick And Mix',
  27: 'Gateway To Heaven',
  28: 'In A State',
  29: 'Rise And Shine',
  30: 'Dirty Gertie',
  31: 'Get Up And Run',
  32: 'Buckle My Shoe',
  33: 'All The Threes',
  34: 'Ask For More',
  36: 'Three Dozen',
  40: 'Naughty Forty',
  42: 'Winnie The Pooh',
  44: 'Droopy Drawers',
  45: 'Halfway There',
  46: 'Up To Tricks',
  47: 'Four And Seven',
  48: 'Four Dozen',
  51: 'Tweak Of The Thumb',
  52: 'Danny La Rue',
  53: 'Stuck In The Tree',
  54: 'Clean The Floor',
  55: 'All The Fives',
  57: 'Heinz Varieties',
  58: 'Make Them Wait',
  59: 'Brighton Line',
  61: 'Bakers Bun',
  62: 'Tickety Boo',
  63: 'Tickle Me',
  66: 'Clickety Click',
  67: 'Made In Heaven',
  69: 'Any Way Up',
  73: 'Queen B',
  77: 'All The Sevens',
  81: 'Stop And Run',
  83: 'Time For Tea',
  85: 'Staying Alive',
  88: 'Two Fat Ladies',
  90: 'Top Of The Shop',
};

export function getNumberNickname(n: number): string | null {
  return NUMBER_NICKNAMES[n] ?? null;
}

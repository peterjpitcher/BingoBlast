// src/lib/number-nicknames.ts
/**
 * The calls the host says at The Anchor, shown above the ball on the host screen.
 *
 * House rules for this list:
 *   - Nothing about death, dying, heaven or the afterlife. Guests have lost
 *     husbands, and a call is shouted out to a whole room with no warning.
 *     "Gateway To Heaven" (27) and "Made In Heaven" (67) were removed for this.
 *     "Debbie McGee" (3) stays: it was queried on the same grounds and the host
 *     kept it, so leave it be.
 *   - Funny, never rude. It is a pub, not a stag do.
 *   - Two to four words, easy to shout, easy to hear over a room.
 *
 * Six calls are load bearing: the room answers them. Do not rename 2, 11, 22,
 * 59, 69 or 88 without changing CALL_RESPONSES in src/lib/house-rules.ts too, or
 * the joke stops making sense.
 *
 * Seven more are the ones a bingo crowd shouts back without being asked, so they
 * stay traditional: 1, 8, 33, 55, 66, 77, 90.
 *
 * Wording is the host's own. Leave it alone unless the host asks. That includes
 * `10: "Andys Den"` with no apostrophe.
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
  18: 'First Legal Pint',
  19: 'Goodbye Teens',
  20: 'Blind Twenty',
  21: 'Key Of The Door',
  22: 'Two Little Ducks',
  23: 'Thee And Me',
  24: 'Two Dozen',
  25: 'Duck And Dive',
  26: 'Pick And Mix',
  27: 'Duck And A Crutch',
  28: 'In A State',
  29: 'Rise And Shine',
  30: 'Dirty Gertie',
  31: 'Get Up And Run',
  32: 'Buckle My Shoe',
  33: 'All The Threes',
  34: 'Ask For More',
  35: 'Jump And Jive',
  36: 'Three Dozen',
  37: 'Nearly Forty',
  38: 'Christmas Cake',
  39: 'The 39 Steps',
  40: 'Naughty Forty',
  41: 'Time For Fun',
  42: 'Winnie The Pooh',
  43: 'Knees Up',
  44: 'Droopy Drawers',
  45: 'Halfway There',
  46: 'Up To Tricks',
  47: 'Four And Seven',
  48: 'Four Dozen',
  49: 'Feeling Fine',
  50: 'Hawaii Five-O',
  51: 'Tweak Of The Thumb',
  52: 'Danny La Rue',
  53: 'Stuck In The Tree',
  54: 'Clean The Floor',
  55: 'All The Fives',
  56: 'Pick Up Sticks',
  57: 'Heinz Varieties',
  58: 'Make Them Wait',
  59: 'Brighton Line',
  60: 'Bus Pass Time',
  61: 'Bakers Bun',
  62: 'Tickety Boo',
  63: 'Tickle Me',
  64: "When I'm Sixty Four",
  65: 'Retirement Age',
  66: 'Clickety Click',
  67: 'Made In Devon',
  68: 'Saving Grace',
  69: 'Any Way Up',
  70: 'Big Seven-O',
  71: 'Bang On The Drum',
  72: 'Six Dozen',
  73: 'Queen B',
  74: 'Hit The Floor',
  75: 'Strive And Strive',
  76: 'Trombones',
  77: 'All The Sevens',
  78: 'Spin The Record',
  79: 'One More Time',
  80: 'Ate Nothing',
  81: 'Stop And Run',
  82: 'Straight On Through',
  83: 'Time For Tea',
  84: 'Seven Dozen',
  85: 'Staying Alive',
  86: 'Between The Sticks',
  87: 'Nearly Ninety',
  88: 'Two Fat Ladies',
  89: 'All But One',
  90: 'Top Of The Shop',
};

export function getNumberNickname(n: number): string | null {
  return NUMBER_NICKNAMES[n] ?? null;
}

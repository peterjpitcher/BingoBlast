export type Segment = { text: string; bold?: boolean };

export type Rule = {
  /** Display character — '➤' or '🎉'. */
  icon: string;
  /** Ordered text segments. Segments with bold:true wrap in <span className="font-bold">. */
  segments: Segment[];
  /**
   * Visual variant. `closing` applies the last-item styling on display:
   *   - `pt-1` on the <li>
   *   - `clamp()`-sized icon
   *   - `font-bold italic` on the text container
   */
  variant?: 'default' | 'closing';
};

/**
 * Single source of truth for the bingo House Rules shown on:
 *   - the public display (waiting / break / completed states)
 *   - the host pre-game briefing (first game of the session only)
 *
 * The shape preserves the existing display markup losslessly. Do not add or
 * remove rules without updating the screenshot baseline.
 */
export const HOUSE_RULES: ReadonlyArray<Rule> = [
  {
    icon: '➤',
    segments: [
      { text: "Claims must be called on the number they're won on - " },
      { text: 'late claims invalid', bold: true },
    ],
  },
  {
    icon: '➤',
    segments: [{ text: 'Multiple claims share the prize' }],
  },
  {
    icon: '➤',
    segments: [
      { text: 'Snowball eligibility: Players must have been here for the last three games' },
    ],
  },
  {
    icon: '🎉',
    segments: [{ text: 'Enjoy the night and best of luck to everyone!' }],
    variant: 'closing',
  },
];

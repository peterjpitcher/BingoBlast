/**
 * The Anchor's printed bingo books: the colour each game is set to, and the
 * name the staff use for it. These are the colours the games have had from the
 * start (they were picked to match the paper), and the names are the ones in
 * the games' own titles ("Game 4 - Peach", "Game 7 - Lilac").
 *
 * Source: the production games table, read on 1 October 2026.
 *
 * They are matched first and exactly. Before this list existed the nearest
 * generic colour won, so the lilac and the peach books were both called
 * "White" and the orange book was called "Yellow", on the TV, the phones and
 * the host's screen.
 */
const BOOK_COLOURS: ReadonlyArray<readonly [name: string, hex: string]> = [
  ['Orange', '#ffa73a'],
  ['Grey',   '#9ca3af'],
  ['Blue',   '#3a7dff'],
  ['Peach',  '#ffbfa3'],
  ['Yellow', '#ffd93b'],
  ['Red',    '#e23b3b'],
  ['Lilac',  '#c8a2ff'],
  ['Brown',  '#8b5a2b'],
  ['Pink',   '#ff66b3'],
  ['Green',  '#28a745'],
];

/** Generic colours, for a game set to something that is not one of the books. */
const GENERIC_COLOURS: ReadonlyArray<readonly [name: string, hex: string]> = [
  ['White',  '#ffffff'],
  ['Black',  '#000000'],
  ['Grey',   '#808080'],
  ['Red',    '#dc2626'],
  ['Orange', '#ea580c'],
  ['Yellow', '#facc15'],
  ['Green',  '#16a34a'],
  ['Teal',   '#0d9488'],
  ['Blue',   '#2563eb'],
  ['Purple', '#9333ea'],
  ['Pink',   '#ec4899'],
  ['Brown',  '#78350f'],
];

const PALETTE = [...BOOK_COLOURS, ...GENERIC_COLOURS];

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Returns the name of a book's colour: the staff's own name when the hex is
 * one of the printed books, otherwise the nearest named colour.
 * Returns the literal `"Unknown colour"` for invalid input, never an empty
 * string. The host is colour-blind; the colour word is the accessibility primary.
 */
export function getColourName(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'Unknown colour';
  let best = 'Unknown colour';
  let bestDist = Infinity;
  for (const [name, paletteHex] of PALETTE) {
    const p = hexToRgb(paletteHex)!;
    const d =
      (rgb[0] - p[0]) ** 2 +
      (rgb[1] - p[1]) ** 2 +
      (rgb[2] - p[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

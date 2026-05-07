const PALETTE: Record<string, string> = {
  White:  '#ffffff',
  Black:  '#000000',
  Grey:   '#808080',
  Red:    '#dc2626',
  Orange: '#ea580c',
  Yellow: '#facc15',
  Green:  '#16a34a',
  Teal:   '#0d9488',
  Blue:   '#2563eb',
  Purple: '#9333ea',
  Pink:   '#ec4899',
  Brown:  '#78350f',
};

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Returns the nearest palette colour name for a given hex string.
 * Returns the literal `"Unknown colour"` for invalid input — never an empty
 * string. The host is colour-blind; the colour word is the accessibility primary.
 */
export function getColourName(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'Unknown colour';
  let best = 'Unknown colour';
  let bestDist = Infinity;
  for (const [name, paletteHex] of Object.entries(PALETTE)) {
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

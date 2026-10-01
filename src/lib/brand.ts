// src/lib/brand.ts
//
// Brand values that have to be passed as a literal colour to something that
// cannot read a CSS variable. Everything else uses the Tailwind names in
// tailwind.config.ts, which read the variables in globals.css.

/**
 * The QR code's ink: Anchor green on a white tile. `qrcode.react` writes it
 * into the SVG, so it is a hex here; keep it equal to --anchor-green.
 */
export const QR_FOREGROUND = '#005131';

/** The QR tile behind it. A QR code needs a true white ground to scan well. */
export const QR_BACKGROUND = '#ffffff';

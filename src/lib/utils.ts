import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The pub TV text sizes, `fontSize` in tailwind.config.ts. Keep the two lists
 * in step: a size missing here is read by tailwind-merge as a text colour, so
 * cn('text-tv-base', 'text-white') would silently drop the size.
 */
export const TV_FONT_SIZES = ['tv-xs', 'tv-sm', 'tv-base', 'tv-lg', 'tv-xl', 'tv-2xl', 'tv-3xl', 'tv-4xl'] as const;

/**
 * The brand's own radius and shadow names (tailwind.config.ts). Unregistered,
 * tailwind-merge does not see `rounded-card` as a radius or `shadow-gold` as a
 * shadow, so cn('rounded-card', 'rounded-full') would keep both and leave the
 * winner to stylesheet order.
 */
export const BRAND_RADII = ['card', 'input'] as const;
export const BRAND_SHADOWS = ['gold', 'lift', 'sheet'] as const;

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: [...BRAND_RADII],
      shadow: [...BRAND_SHADOWS],
    },
    classGroups: {
      'font-size': [{ text: [...TV_FONT_SIZES] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function getContrastColor(hexColor: string): 'text-white' | 'text-slate-900' {
  // Default to white if invalid
  if (!hexColor || !hexColor.startsWith('#')) return 'text-white';

  let normalized = hexColor.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    normalized = `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return 'text-white';
  
  // Convert hex to RGB
  const r = parseInt(normalized.substr(1, 2), 16);
  const g = parseInt(normalized.substr(3, 2), 16);
  const b = parseInt(normalized.substr(5, 2), 16);
  
  if (isNaN(r) || isNaN(g) || isNaN(b)) return 'text-white';

  // Calculate luminance (YIQ formula)
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  
  // If luminance is high (bright), use dark text. Else use white.
  // Threshold 128 is standard, but 150 feels safer for "white" text readability.
  return (yiq >= 150) ? 'text-slate-900' : 'text-white';
}

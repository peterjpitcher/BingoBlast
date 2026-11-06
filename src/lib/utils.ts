// cn() and the tailwind-merge name lists come from the shared kit
// (@anchor-nights/kit/ui), which knows the kit's TV sizes, radii and shadows.
// Re-exported here because about forty files import cn from '@/lib/utils'.
export { BRAND_RADII, BRAND_SHADOWS, TV_FONT_SIZES, cn } from '@anchor-nights/kit/ui';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

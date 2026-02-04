import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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

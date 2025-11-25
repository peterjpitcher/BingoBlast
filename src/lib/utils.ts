import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getContrastColor(hexColor: string): 'text-white' | 'text-slate-900' {
  // Default to white if invalid
  if (!hexColor || !hexColor.startsWith('#')) return 'text-white';
  
  // Convert hex to RGB
  const r = parseInt(hexColor.substr(1, 2), 16);
  const g = parseInt(hexColor.substr(3, 2), 16);
  const b = parseInt(hexColor.substr(5, 2), 16);
  
  if (isNaN(r) || isNaN(g) || isNaN(b)) return 'text-white';

  // Calculate luminance (YIQ formula)
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  
  // If luminance is high (bright), use dark text. Else use white.
  // Threshold 128 is standard, but 150 feels safer for "white" text readability.
  return (yiq >= 150) ? 'text-slate-900' : 'text-white';
}

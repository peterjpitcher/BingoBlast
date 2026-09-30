// src/lib/events-feed/image-host.ts
//
// Where event images may be loaded from. One source for both next.config.ts
// (`images.remotePatterns`) and the projection, which drops any image URL that
// next/image would refuse, so a stray URL becomes a text-only card instead of
// a render error on the pub TV.
//
// next.config.ts imports this file directly, so it must stay free of imports,
// path aliases and TypeScript-only runtime syntax (enums, namespaces).

/** The management app's Supabase project, which hosts the event artwork. */
export const EVENT_IMAGE_HOST = 'tfcasgxopxegwrabvwat.supabase.co';

/** The public event-images bucket; nothing else on that host is allowed. */
export const EVENT_IMAGE_PATH_PREFIX = '/storage/v1/object/public/event-images/';

/**
 * True when the URL is an https image in the event-images bucket, with no
 * port, credentials or query string: exactly what `remotePatterns` allows.
 */
export function isAllowedEventImageUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === EVENT_IMAGE_HOST &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.search === '' &&
    parsed.pathname.startsWith(EVENT_IMAGE_PATH_PREFIX) &&
    parsed.pathname.length > EVENT_IMAGE_PATH_PREFIX.length
  );
}

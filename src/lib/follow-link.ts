// src/lib/follow-link.ts
//
// The follow-along link behind the TV's QR codes (spec 5.4).
//
// When the TV's session is the one /play would pick by itself (the unique
// qualifying session, src/lib/session-resolution.ts), the QR is the short
// `<origin>/play`: about 37 characters, a 29x29 code at level M. Otherwise it
// carries the id, `<origin>/play?s=<id>`, so every QR leads to the session its
// TV shows (R12): when staff picked a session from a list, and in rehearsal.

export interface BuildFollowUrlInput {
  origin: string;
  sessionId: string;
  isUniqueSession: boolean;
}

export function buildFollowUrl({ origin, sessionId, isUniqueSession }: BuildFollowUrlInput): string {
  const base = `${origin.replace(/\/+$/, '')}/play`;
  return isUniqueSession ? base : `${base}?s=${encodeURIComponent(sessionId)}`;
}

/** The address as printed under a QR: no "https://". */
export function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

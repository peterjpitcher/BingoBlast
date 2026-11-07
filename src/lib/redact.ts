// src/lib/redact.ts
//
// The one redaction rule for anything that leaves the app as an error report.
// src/lib/report-error.ts applies it before posting, and the receiving route
// (src/app/api/errors/route.ts) applies it again before the insert, so a
// sender that skipped it, or an older one, still stores nothing it should not.
//
// This app deliberately does not identify players. Postgres puts the failing
// row into DETAIL on a constraint violation, and a message can still carry a
// uuid, an email address, a phone number or a prize amount. Each is masked.

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const MONEY_RE = /£\s?\d[\d,]*(\.\d{1,2})?/g;
// UK numbers in the shapes people type them: +44 or 0, then ten more digits,
// optionally split by single spaces or hyphens. Anchored on +44 or a leading
// 0 so dates and ball numbers ("2026-11-06", "1, 2, 3") are left alone.
const UK_PHONE_RE = /(?:\+44\s?|\b0)\d(?:[\s-]?\d){8,9}\b/g;

/** Masks uuids, email addresses, UK phone numbers and pound amounts. */
export function redact(value: string): string {
  return value
    .replace(UUID_RE, '[uuid]')
    .replace(EMAIL_RE, '[email]')
    .replace(UK_PHONE_RE, '[phone]')
    .replace(MONEY_RE, '[amount]');
}

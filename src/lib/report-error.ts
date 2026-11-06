// src/lib/report-error.ts
//
// Where a technical failure goes so somebody can find it the morning after:
// the shared kit's reporter (@anchor-nights/kit/errors) with this app's name
// filled in. Call sites keep importing reportError from here.
//
// ERROR_SINK_URL points at this app's own /api/errors route, which stores the
// report in public.app_errors (spec assumption A3, Anchor Nights standard, 6
// November 2026: no paid service) and lists it on /admin/errors. When Supabase
// itself is down the insert fails too, which is why the kit writes the console
// line first and unconditionally, so Vercel's logs still hold the failure.
//
// The kit's reporter only ever sends the message and code, masks uuids, email
// addresses, UK phone numbers and pound amounts, gives up on the sink after 2
// seconds and never throws. With no ERROR_SINK_URL it only logs.

import { createErrorReporter, type ErrorContext } from '@anchor-nights/kit/errors';

export type { ErrorContext };

/** Reports a technical failure as 'anchor-bingo'. Never throws and never rejects. */
export const reportError = createErrorReporter({ app: 'anchor-bingo' });

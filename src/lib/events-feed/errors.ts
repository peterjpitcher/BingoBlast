// src/lib/events-feed/errors.ts
//
// One error type for everything that can go wrong reading the management app.
// Messages are written here, never copied from a response body, so reporting
// one can never leak what the management app sent back (or the key).

export type EventsFeedErrorCode = 'missing_config' | 'timeout' | 'network' | 'http' | 'parse';

export class EventsFeedError extends Error {
  readonly code: EventsFeedErrorCode;

  constructor(message: string, code: EventsFeedErrorCode) {
    super(message);
    this.name = 'EventsFeedError';
    this.code = code;
  }
}

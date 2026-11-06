// src/lib/dates.ts
//
// Europe/London dates now come from the shared kit (@anchor-nights/kit/dates),
// which was extracted from this file. This re-export stays because about
// twenty files import '@/lib/dates', including the events feed and playlist,
// which move to the kit in a later step (C-4) and are left untouched until then.
export * from '@anchor-nights/kit/dates';

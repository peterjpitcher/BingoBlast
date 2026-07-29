// src/lib/call-timing.ts
/**
 * Timing constants for the call pipeline.
 *
 * The host gap and the public reveal delay are DIFFERENT things and must never
 * be conflated again:
 *   - HOST_MIN_CALL_GAP_MS is a server-side anti-double-tap window only.
 *   - call_delay_seconds (per game_states row) is how long the public surfaces
 *     wait before revealing a ball. It is NOT a host gap.
 */
export const HOST_MIN_CALL_GAP_MS = 400;
export const DEFAULT_PUBLIC_CALL_DELAY_SECONDS = 3;
/** Minimum time a backlogged ball stays on screen before the next one. */
export const PUBLIC_MIN_DWELL_MS = 1200;

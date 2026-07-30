/**
 * Idempotency keys for recording a winner.
 *
 * `record_winner_atomic` cannot tell a retry from a tie on the claim data alone:
 * two punters shouting on the same ball is a legitimate pair of rows at the same
 * stage and the same `call_count_at_win`. So the caller supplies the identity.
 * One key means one claim attempt. A lost response retried with the same key is
 * refused by the unique index and answered with the current state, while a
 * genuine tie is a separate attempt, a separate key, and both rows save.
 *
 * The rule for callers: mint a key when the Record Winner modal opens, keep it
 * for every attempt at that claim including retries, and mint a fresh one for
 * the next claim. "Validate Another Winner" is a next claim.
 *
 * See supabase/migrations/20260730064309_winner_idempotency_key.sql.
 */

/**
 * Formats 16 random bytes as a RFC 4122 version 4 UUID.
 *
 * Exported for the tests. Production code wants {@link newClaimRequestId}.
 */
export function uuidV4FromBytes(bytes: Uint8Array): string {
    if (bytes.length !== 16) {
        throw new Error('A v4 UUID needs exactly 16 bytes.');
    }
    const b = Uint8Array.from(bytes);
    // Version 4 in the high nibble of byte 6, RFC 4122 variant in byte 8.
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;

    const hex = Array.from(b, (byte) => byte.toString(16).padStart(2, '0'));
    return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10, 16).join(''),
    ].join('-');
}

/**
 * Mints a key for one claim attempt.
 *
 * `crypto.randomUUID()` needs a secure context, which the host page has in
 * production and on localhost. The `getRandomValues` fallback covers the case it
 * does not, because a host who cannot mint a key would be sending null and
 * silently losing the duplicate protection.
 */
export function newClaimRequestId(): string {
    const source = globalThis.crypto;

    if (typeof source?.randomUUID === 'function') {
        return source.randomUUID();
    }
    if (typeof source?.getRandomValues === 'function') {
        return uuidV4FromBytes(source.getRandomValues(new Uint8Array(16)));
    }

    throw new Error('No secure random source is available to key this claim.');
}

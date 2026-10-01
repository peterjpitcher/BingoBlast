/**
 * Client-minted ids for the host screen: the claim attempt, the call key and
 * the manual snowball award key.
 *
 * `record_winner_atomic` cannot tell a retry from a tie on the claim data alone:
 * two punters shouting on the same ball is a legitimate pair of rows at the same
 * stage and the same `call_count_at_win`. So the caller supplies the identity,
 * and since 1 October 2026 that identity is the CLAIM ATTEMPT. The host's phone
 * mints one when the host taps Check Claim or Check another claimant, and hands
 * it to begin_claim_check (20261001000200_claim_attempts.sql). The attempt then
 * binds the draft, the verdict, the one permitted undo and the recorded winner:
 * it is what record_winner_atomic takes as `p_client_request_id`, and from
 * 20261001000400_claim_enforcement.sql a new winner needs that attempt with a
 * 'valid' verdict. A lost response retried with the same attempt inserts
 * nothing and returns the current state, while a genuine tie is a separate
 * attempt and both rows save. The old rule, a key minted when the Record Winner
 * modal opened, is gone with that modal's key.
 *
 * The same minting serves two other keys: the call_next_number key for one
 * intended ball (20260825080606_call_next_number_idempotency.sql), and a fresh
 * key per Manual Snowball Win, the one route that records a winner without a
 * checked claim.
 *
 * See supabase/migrations/20260730064309_winner_idempotency_key.sql for the
 * unique index the winner key relies on.
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
 * Mints an id: a claim attempt, a call key or a manual award key.
 *
 * `crypto.randomUUID()` needs a secure context, which the host page has in
 * production and on localhost. The `getRandomValues` fallback covers the case it
 * does not, because a host who cannot mint an id would be sending null and
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

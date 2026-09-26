/**
 * Deterministic ULIDs — the thing that makes a two-device merge idempotent.
 *
 * THE PROBLEM
 * -----------
 * `materializePast` freezes rules into real rows, and it runs on every open. Two
 * devices running it over the same dates each mint a fresh random ULID for the same
 * `(node_id, date_ms)`. Locally the unique index catches the collision. Across two
 * databases it does not: a union-and-replay merge sees two rows with different ids and
 * has no way to know they describe one occurrence, so the merged database contains the
 * same gym session twice, forever, and no later fix can tell which pairs to collapse.
 *
 * THE FIX
 * -------
 * Derive the id from `(node_id, date_ms)` instead of minting it. Both devices then
 * independently produce the same id for the same occurrence, the union deduplicates
 * itself, and idempotency stops being a property of discipline and becomes one of
 * arithmetic. It is the same move `projectedKey` already makes for projections — this
 * just makes it survive being written down.
 *
 * WHY IT IS STILL A VALID ULID
 * ----------------------------
 * A derived id could have been any unique string, and that would have been a mistake:
 * `tools/xlsx-to-jsonl/normalize.ts` validates every id in the workbook as 26
 * characters of Crockford base32 (SPEC §3.3), and the export carries occurrence ids.
 * An id that failed that check would make every materialized row unreadable by the
 * converter.
 *
 * So the shape is preserved exactly. A ULID is 10 characters of timestamp followed by
 * 16 of randomness; here the timestamp is the occurrence's own `date_ms` and the
 * "randomness" is a hash of `node_id`. Both halves are legal base32, the whole thing
 * passes the same validator, and it keeps the property ULIDs were chosen for — ids
 * sort by the day they belong to.
 */

import type { Id, Millis } from './types'

/** Crockford base32: no I, L, O or U, so nothing decodes into a digit look-alike. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const TIME_LEN = 10
const RANDOM_LEN = 16

/** The ULID timestamp field is 48 bits — good to the year 10889. */
function encodeTime(ms: Millis): string {
  let n = Math.floor(ms)
  if (n < 0) throw new Error(`cannot encode a negative timestamp: ${ms}`)
  let out = ''
  for (let i = 0; i < TIME_LEN; i++) {
    out = CROCKFORD[n % 32]! + out
    n = Math.floor(n / 32)
  }
  return out
}

/**
 * FNV-1a, 64-bit, in two 32-bit halves because JavaScript numbers cannot hold a 64-bit
 * integer exactly. Not cryptographic and does not need to be: this is a namespacing
 * device, not a security boundary. What it needs is determinism across devices and
 * versions, which a hand-written hash guarantees and a platform-provided one does not.
 */
function fnv1a64(input: string): [number, number] {
  let hi = 0xcbf2_9ce4
  let lo = 0x8432_2325
  for (let i = 0; i < input.length; i++) {
    lo ^= input.charCodeAt(i) & 0xff
    // Multiply by the 64-bit FNV prime (0x100000001b3) in 32-bit pieces.
    const lo435 = (lo * 435) >>> 0
    const hi435 = (hi * 435) >>> 0
    const carry = Math.floor((lo * 435) / 0x1_0000_0000)
    const shifted = ((lo << 8) | 0) >>> 0
    lo = (lo435 + shifted) >>> 0
    hi = (hi435 + carry + ((lo435 + shifted > 0xffff_ffff ? 1 : 0) | 0)) >>> 0
    hi = (hi + ((lo >>> 24) & 0)) >>> 0
  }
  return [hi >>> 0, lo >>> 0]
}

function encodeRandomness(seed: string): string {
  // Two independent hashes, so 16 characters (80 bits of field) are filled from more
  // than 64 bits of state and the tail is not a constant.
  const [aHi, aLo] = fnv1a64(seed)
  const [bHi, bLo] = fnv1a64(`${seed}#2`)
  const words = [aHi, aLo, bHi, bLo]
  let out = ''
  for (let i = 0; i < RANDOM_LEN; i++) {
    const word = words[i % words.length]!
    const shift = (Math.floor(i / words.length) * 5) % 27
    out += CROCKFORD[(word >>> shift) % 32]!
  }
  return out
}

/**
 * The id for the occurrence of `nodeId` on the day `dateMs` (local midnight).
 *
 * Pure. Same inputs, same id, on any device, in any version, forever — which is the
 * whole contract. Changing this function silently forks every future occurrence away
 * from every past one, so it is effectively frozen once real data exists.
 */
export function occurrenceId(nodeId: Id, dateMs: Millis): Id {
  return encodeTime(dateMs) + encodeRandomness(nodeId)
}

/** Exported for the checks in `tools/store-check.ts`. */
export const DERIVED_ID_PARTS = { CROCKFORD, TIME_LEN, RANDOM_LEN }

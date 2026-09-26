/**
 * ULID generation. Never autoincrement — two devices writing one dataset with integer
 * ids collide the instant sync exists (§5.6).
 *
 * ULIDs are also lexicographically sortable by creation time, which is free ordering.
 *
 * `monotonicFactory` rather than bare `ulid()`: two ids minted in the same millisecond
 * from the plain function get independent random tails, so their sort order is random.
 * The monotonic factory increments the random component instead, which keeps
 * creation order recoverable from the id alone — the whole reason for choosing ULIDs.
 */

import { decodeTime, monotonicFactory } from 'ulid'
import type { Id, Millis } from './types'

const next = monotonicFactory()

/** @param seedTime optional explicit timestamp, for deterministic fixtures and replay. */
export const newId = (seedTime?: Millis): Id => next(seedTime)

/**
 * Crockford base32: no I, L, O or U, so nothing decodes into a digit look-alike.
 * A human retyping or autofilling an id in a spreadsheet has to fail this (SPEC §3.3).
 */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

export const isUlid = (s: unknown): s is Id =>
  typeof s === 'string' && ULID_PATTERN.test(s)

/** The embedded creation timestamp. Throws on a malformed id — callers validate first. */
export const idTime = (id: Id): Millis => decodeTime(id)

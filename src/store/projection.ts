/**
 * The one place the past/future merge is implemented (§5.5).
 *
 * Materialized rows win; rules fill the future; a projection is dropped wherever a real
 * row already covers the same `(node_id, date_ms)`.
 *
 * It takes loose collections rather than a Store because it has two callers that are
 * not the same kind of thing: the live store, and a `WorldState` produced by replaying
 * the event log to a past timestamp. The revision scrubber needs *exactly* this logic
 * applied to a reconstructed past — and if it had its own copy, the two would drift and
 * the "as of" view would quietly stop matching the live one, which is the single bug
 * most likely to go unnoticed for months (CLAUDE.md invariant 10).
 */

import { expand, projectedKey } from '../core/recurrence'
import { localMidnight } from '../core/time'
import type { Block, Millis, Occurrence, Recurrence } from '../core/types'

export interface BlockSource {
  occurrences: Iterable<Occurrence>
  recurrences: Iterable<Recurrence>
}

export interface BlockRange {
  from: Millis
  to: Millis
  /**
   * The past/future boundary. Normally local midnight today — but when replaying to a
   * past revision it is local midnight *of that revision*, which is what makes an
   * "as of" view show what was planned then rather than what is planned now.
   */
  frozenBefore: Millis
}

export function blocksIn(source: BlockSource, range: BlockRange): Block[] {
  const out: Block[] = []
  const taken = new Set<string>()

  for (const occ of source.occurrences) {
    if (occ.date_ms >= range.from && occ.date_ms < range.to) {
      out.push(occ)
      taken.add(projectedKey(occ.node_id, occ.date_ms))
    }
  }

  for (const rule of source.recurrences) {
    for (const p of expand(rule, range)) {
      if (!taken.has(p.key)) out.push(p)
    }
  }

  return out.sort(
    (a, b) => a.date_ms - b.date_ms || (a.start_ms ?? 0) - (b.start_ms ?? 0),
  )
}

/** Sugar for the common live case: frozen at today. */
export const blocksNow = (source: BlockSource, from: Millis, to: Millis, nowMs: Millis): Block[] =>
  blocksIn(source, { from, to, frozenBefore: localMidnight(nowMs) })

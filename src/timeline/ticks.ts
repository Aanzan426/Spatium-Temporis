/**
 * Tick generation, culled to the viewport.
 *
 * Compute the FIRST VISIBLE tick and step forward. Never iterate every day between
 * 1900 and 2100 — that freezes the app the moment you zoom out, and it is the single
 * most common way this kind of view dies (§6).
 *
 * Stepping is calendar-aware, not arithmetic: months have different lengths and days
 * have different durations across DST. Use date-fns, via src/core/time.ts.
 *
 * THE GUARD IS NOT PARANOIA
 * -------------------------
 * `floor`/`next` come from a band, and a band is data — including data someone adds
 * later. A `next` that fails to advance (returns its input) turns this into an infinite
 * loop that hangs the tab with no stack to look at. The counter below turns that bug
 * into a visibly wrong axis, which is diagnosable in seconds.
 */

import type { Band } from './bands'
import type { Millis } from '../core/types'

export interface Tick {
  t: Millis
  label: string
  /** Every nth tick drawn heavier — Mondays, January, years divisible by five. */
  emphasis: boolean
}

/** No viewport at any sane zoom needs more than this; see the header. */
const MAX_TICKS = 2_000

/**
 * Ticks covering [from, to), plus one on each side so labels that straddle an edge
 * still draw and the axis does not visibly "end" at the viewport boundary.
 */
export function ticksFor(band: Band, from: Millis, to: Millis): Tick[] {
  const out: Tick[] = []
  if (!(to > from)) return out

  // Start one unit before the first visible boundary, for the straddling label.
  let t = band.floor(from)
  const start = band.floor(t - 1)
  t = start

  for (let guard = 0; guard < MAX_TICKS; guard++) {
    if (t >= to) {
      // One past the right edge, then stop.
      out.push({ t, label: band.label(t), emphasis: band.emphasis?.(t) ?? false })
      break
    }
    out.push({ t, label: band.label(t), emphasis: band.emphasis?.(t) ?? false })
    const advanced = band.next(t)
    if (advanced <= t) break // a band whose `next` does not advance; see the header
    t = advanced
  }
  return out
}

/**
 * How many ticks this band would produce across the range, without building them.
 * Used to decide whether to label every tick or only the emphasised ones — a decision
 * that has to be made before drawing, not after discovering the labels overlap.
 */
export function tickDensity(band: Band, from: Millis, to: Millis): number {
  return (to - from) / band.unit
}

/**
 * Label every tick when they are far apart, only the emphasised ones when they crowd.
 * `pxPerTick` is `band.unit * scale`.
 */
export function labelStrategy(pxPerTick: number): 'all' | 'emphasis' | 'none' {
  if (pxPerTick >= 52) return 'all'
  if (pxPerTick >= 9) return 'emphasis'
  return 'none'
}

/**
 * Zoom bands. A band is one row of data, not a view:
 *
 *   { minScale, maxScale, tickGenerator, labelFormat }
 *
 * WHICH BAND IS ACTIVE IS DERIVED FROM `scale` — never a mode that gets switched.
 * Adding centuries later is adding a row. Adding seconds is adding a row. No new
 * rendering code, ever.
 *
 * Bands cross-fade on opacity across their overlap so zoom feels continuous rather
 * than snapping.
 *
 * Phase 1 registers exactly four: day, week, month, year. Hours and decades/centuries
 * are deliberately unregistered until the mechanism is proven (§6) — the rows for them
 * are written below and commented out, which is the whole argument for the design: the
 * feature is four lines that already exist.
 *
 * WHY THRESHOLDS ARE WRITTEN AS PIXELS-PER-UNIT
 * ---------------------------------------------
 * `minScale: 4.6e-7` is unreadable and unreviewable. `unitPx(DAY_MS, 14, 260)` says
 * "the day band is on while a day is between 14 and 260 pixels wide", which is a claim
 * you can check by measuring the screen.
 */

import {
  DAY_MS,
  DECADE_MS,
  HOUR_MS,
  MONTH_MS,
  WEEK_MS,
  YEAR_MS,
  addDays,
  addMonths,
  addWeeks,
  addYears,
  fmt,
  localDayEnd,
  localDecadeStart,
  localMidnight,
  localMonthStart,
  localWeekStart,
  localYearStart,
} from '../core/time'
import type { Magnitude, Millis } from '../core/types'

export interface Band {
  name: 'hour' | 'day' | 'week' | 'month' | 'year' | 'decade'
  /** Scale (px/ms) at which this band starts appearing. */
  minScale: number
  /** Scale at which it has fully faded out. */
  maxScale: number
  /** Nominal unit width, used only for fade maths and label spacing. */
  unit: Millis
  /** Snap an instant down to this band's grid. */
  floor: (ms: Millis) => Millis
  /** Step one unit forward. Calendar-aware — never `+ unit`. */
  next: (ms: Millis) => Millis
  label: (ms: Millis) => string
  /** Every nth tick is drawn heavier and labelled where space is tight. */
  emphasis?: (ms: Millis) => boolean
}

/** Read as: this band is alive while one `unit` measures between `minPx` and `maxPx`. */
const unitPx = (unit: Millis, minPx: number, maxPx: number) => ({
  unit,
  minScale: minPx / unit,
  maxScale: maxPx / unit,
})

export const HOUR_BAND: Band = {
  name: 'hour',
  ...unitPx(HOUR_MS, 26, 4000),
  floor: (ms) => Math.floor(ms / HOUR_MS) * HOUR_MS,
  next: (ms) => ms + HOUR_MS,
  label: (ms) => fmt(ms, 'HH:mm'),
  emphasis: (ms) => new Date(ms).getHours() % 6 === 0,
}

export const DAY_BAND: Band = {
  name: 'day',
  ...unitPx(DAY_MS, 14, 900),
  floor: localMidnight,
  next: (ms) => addDays(ms, 1),
  label: (ms) => fmt(ms, 'EEE d'),
  emphasis: (ms) => new Date(ms).getDay() === 1,
}

export const WEEK_BAND: Band = {
  name: 'week',
  ...unitPx(WEEK_MS, 22, 620),
  floor: localWeekStart,
  next: (ms) => addWeeks(ms, 1),
  label: (ms) => fmt(ms, 'd MMM'),
  emphasis: (ms) => new Date(ms).getDate() <= 7,
}

export const MONTH_BAND: Band = {
  name: 'month',
  ...unitPx(MONTH_MS, 26, 560),
  floor: localMonthStart,
  next: (ms) => addMonths(ms, 1),
  label: (ms) => fmt(ms, 'MMM'),
  emphasis: (ms) => new Date(ms).getMonth() === 0,
}

export const YEAR_BAND: Band = {
  name: 'year',
  ...unitPx(YEAR_MS, 30, 900),
  floor: localYearStart,
  next: (ms) => addYears(ms, 1),
  label: (ms) => fmt(ms, 'yyyy'),
  emphasis: (ms) => new Date(ms).getFullYear() % 5 === 0,
}

export const DECADE_BAND: Band = {
  name: 'decade',
  ...unitPx(DECADE_MS, 36, 900),
  floor: localDecadeStart,
  next: (ms) => addYears(ms, 10),
  label: (ms) => `${new Date(ms).getFullYear()}s`,
}

/**
 * Phase 1 registers four (§6). `HOUR_BAND` and `DECADE_BAND` are built and tested above
 * but not registered — turning them on is adding them to this array and nothing else,
 * which is the claim the design makes and this file has to be able to back up.
 */
export const BANDS: readonly Band[] = [DAY_BAND, WEEK_BAND, MONTH_BAND, YEAR_BAND]

export interface ActiveBand {
  band: Band
  /** 0…1. Bands cross-fade across their overlap so zoom never snaps. */
  opacity: number
}

/**
 * Which bands are visible at this scale, and how strongly.
 *
 * Fade is computed in log space because scale is multiplicative — a linear ramp spends
 * most of its travel in the last octave of the zoom and produces a fade that feels
 * lopsided in one direction. `log` makes it symmetric, which is what the eye expects.
 */
export function activeBands(scale: number): ActiveBand[] {
  const out: ActiveBand[] = []
  for (const band of BANDS) {
    const opacity = bandOpacity(band, scale)
    if (opacity > 0.01) out.push({ band, opacity })
  }
  return out
}

/** Fully opaque through the middle of a band's range, ramping at either end. */
export function bandOpacity(band: Band, scale: number): number {
  if (scale <= band.minScale || scale >= band.maxScale) return 0
  const lo = Math.log(band.minScale)
  const hi = Math.log(band.maxScale)
  const s = Math.log(scale)
  const rampIn = (s - lo) / ((hi - lo) * 0.25)
  const rampOut = (hi - s) / ((hi - lo) * 0.25)
  return Math.max(0, Math.min(1, rampIn, rampOut))
}

/** The dominant band — what the axis is "currently", for labels and status text. */
export function primaryBand(scale: number): Band {
  const active = activeBands(scale)
  if (active.length) {
    return active.reduce((a, b) => (b.opacity > a.opacity ? b : a)).band
  }
  // Outside every registered band's range: fall back to the nearest edge rather than
  // rendering nothing, which is what an unregistered zoom extreme would otherwise do.
  return scale > BANDS[0]!.maxScale ? BANDS[0]! : BANDS[BANDS.length - 1]!
}

// ---------------------------------------------------------------------------
// Magnitude — the zoom filter (§4)
// ---------------------------------------------------------------------------

/**
 * ZOOM LEVEL SELECTS MAGNITUDE. This function is that sentence.
 *
 * Zoomed to a day → micro + kilo. To a month → micro dissolves, kilo + mega render.
 * To decades → only tera. Without this, every zoom level renders everything, the view
 * becomes noise at a few thousand nodes, and the tool dies.
 *
 * A node with no magnitude always renders. Capture is never gated on classification
 * (§5.1), so an unclassified thought that vanished at certain zooms would punish the
 * exact behaviour the app is built to encourage.
 */
export function magnitudesForScale(scale: number): Set<Magnitude> {
  const dayPx = DAY_MS * scale
  if (dayPx >= 60) return new Set<Magnitude>(['micro', 'kilo', 'mega', 'giga', 'tera'])
  if (dayPx >= 8) return new Set<Magnitude>(['kilo', 'mega', 'giga', 'tera'])
  if (dayPx >= 0.8) return new Set<Magnitude>(['mega', 'giga', 'tera'])
  if (dayPx >= 0.08) return new Set<Magnitude>(['giga', 'tera'])
  return new Set<Magnitude>(['tera'])
}

/**
 * Magnitudes fade rather than pop, for the same reason bands do — a bar that vanishes
 * between one frame and the next reads as a bug, not as a filter.
 */
export function magnitudeOpacity(magnitude: Magnitude | null, scale: number): number {
  if (magnitude === null) return 1
  const visible = magnitudesForScale(scale)
  if (visible.has(magnitude)) return 1
  const wider = magnitudesForScale(scale * 1.6)
  return wider.has(magnitude) ? 0.25 : 0
}

export { localDayEnd }

/**
 * Every time helper in the project. Nothing else does date arithmetic.
 *
 * Rules (§5.7):
 *   - Store UTC epoch ms. Render local. Never hand-roll `+ 86400000`.
 *   - Use date-fns. DST and variable month lengths will eat a weekend otherwise.
 *
 * The one that will bite: an occurrence's `date_ms` is LOCAL MIDNIGHT of the day it
 * belongs to, not the UTC instant of its start time. Get this wrong and a 6am session
 * lands on the wrong day twice a year, looking exactly like random corruption.
 *
 * WHERE THE `_MS` CONSTANTS ARE ALLOWED
 * -------------------------------------
 * `DAY_MS` and friends below are *scale* quantities — "how many pixels is a day wide
 * right now". They are nominal, they are wrong across DST by an hour, and that is fine,
 * because nothing calendar-visible is computed from them. The moment one is used to
 * answer "what day is it", it is a bug. Use `addDays`/`startOfDay` for that.
 */

import {
  addDays as fnsAddDays,
  addMonths as fnsAddMonths,
  addWeeks as fnsAddWeeks,
  addYears as fnsAddYears,
  differenceInCalendarDays,
  endOfDay,
  format,
  getDay,
  isSameDay,
  parse,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import type { Millis, Precision } from './types'
import { PRECISION_FUZZ } from './types'

// ---------------------------------------------------------------------------
// Nominal durations — scale math only. See the header.
// ---------------------------------------------------------------------------

export const SECOND_MS = 1_000
export const MINUTE_MS = 60 * SECOND_MS
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS
export const WEEK_MS = 7 * DAY_MS
export const MONTH_MS = 30.436_875 * DAY_MS
export const YEAR_MS = 365.2425 * DAY_MS
export const DECADE_MS = 10 * YEAR_MS

// ---------------------------------------------------------------------------
// Calendar boundaries. All local. All returning epoch ms.
// ---------------------------------------------------------------------------

export const now = (): Millis => Date.now()

/** LOCAL midnight of the day `ms` falls in. This is what `occurrences.date_ms` holds. */
export const localMidnight = (ms: Millis): Millis => startOfDay(ms).getTime()
export const localDayEnd = (ms: Millis): Millis => endOfDay(ms).getTime()

/** Weeks start Monday: a schedule reads Mon–Sun, and the fold grid follows the schedule. */
export const localWeekStart = (ms: Millis): Millis =>
  startOfWeek(ms, { weekStartsOn: 1 }).getTime()
export const localMonthStart = (ms: Millis): Millis => startOfMonth(ms).getTime()
export const localQuarterStart = (ms: Millis): Millis => startOfQuarter(ms).getTime()
export const localYearStart = (ms: Millis): Millis => startOfYear(ms).getTime()

/** Decades start at ...0. Derived from the year, never from `DECADE_MS`. */
export const localDecadeStart = (ms: Millis): Millis => {
  const y = new Date(localYearStart(ms)).getFullYear()
  return new Date(y - (((y % 10) + 10) % 10), 0, 1).getTime()
}

export const addDays = (ms: Millis, n: number): Millis => fnsAddDays(ms, n).getTime()
export const addWeeks = (ms: Millis, n: number): Millis => fnsAddWeeks(ms, n).getTime()
export const addMonths = (ms: Millis, n: number): Millis => fnsAddMonths(ms, n).getTime()
export const addYears = (ms: Millis, n: number): Millis => fnsAddYears(ms, n).getTime()

export const sameDay = (a: Millis, b: Millis): boolean => isSameDay(a, b)
export const daysBetween = (a: Millis, b: Millis): number =>
  differenceInCalendarDays(b, a)

/** 0 = Sunday … 6 = Saturday, local — the convention `recurrences.weekdays` uses. */
export const weekday = (ms: Millis): number => getDay(ms)

// ---------------------------------------------------------------------------
// Formatting. Render local, always.
// ---------------------------------------------------------------------------

export const fmtDate = (ms: Millis): string => format(ms, 'yyyy-MM-dd')
export const fmtTime = (ms: Millis): string => format(ms, 'HH:mm')
export const fmtWeekdayShort = (ms: Millis): string => format(ms, 'EEE')
export const fmtDateTime = (ms: Millis): string => format(ms, 'yyyy-MM-dd HH:mm')
export const fmtIso = (ms: Millis): string => format(ms, "yyyy-MM-dd'T'HH:mm:ssXXX")
export const fmt = (ms: Millis, pattern: string): string => format(ms, pattern)

/**
 * `YYYY-MM-DD` → local midnight.
 *
 * NOT `new Date('2026-08-01')`, which parses as midnight **UTC** and lands on the
 * previous day in any negative-offset zone (SPEC §3.2). `parse` is local by definition.
 */
export const parseLocalDate = (s: string): Millis =>
  parse(s, 'yyyy-MM-dd', new Date(0)).getTime()

/** `YYYY-MM-DD` + `HH:MM` → local instant. Blank time yields local midnight. */
export const parseLocalDateTime = (date: string, time?: string | null): Millis =>
  time ? parse(`${date} ${time}`, 'yyyy-MM-dd HH:mm', new Date(0)).getTime()
       : parseLocalDate(date)

/** Minutes past local midnight → an instant on the day `dateMs` belongs to. */
export const atMinutes = (dateMs: Millis, minutes: number | null): Millis | null =>
  minutes === null ? null : localMidnight(dateMs) + minutes * MINUTE_MS

/** The inverse. Used when a block's time-of-day is lifted back into a rule. */
export const minutesOfDay = (ms: Millis): number =>
  Math.round((ms - localMidnight(ms)) / MINUTE_MS)

// ---------------------------------------------------------------------------
// Precision
// ---------------------------------------------------------------------------

/**
 * The soft edges of an imprecise endpoint, for rendering only (§3). An `exact` endpoint
 * has zero fuzz and draws a hard edge; a `someday` endpoint fades across a decade.
 */
export const fuzzOf = (p: Precision): Millis => PRECISION_FUZZ[p]

/** True when an endpoint should be drawn as a gradient rather than a line. */
export const isFuzzy = (p: Precision): boolean => PRECISION_FUZZ[p] > 0

/**
 * A human label for a span endpoint, honest about its precision: an `exact` start reads
 * `2026-08-01 06:00`, a `year` start reads `2026`, a `someday` start reads `someday`.
 */
export const fmtAtPrecision = (ms: Millis, p: Precision): string => {
  switch (p) {
    case 'exact': return fmtDateTime(ms)
    case 'hour': return format(ms, 'yyyy-MM-dd HH:00')
    case 'day': return fmtDate(ms)
    case 'week': return `week of ${fmtDate(localWeekStart(ms))}`
    case 'month': return format(ms, 'MMM yyyy')
    case 'quarter': return format(ms, 'QQQ yyyy')
    case 'year': return format(ms, 'yyyy')
    case 'decade': return `${new Date(localDecadeStart(ms)).getFullYear()}s`
    case 'someday': return 'someday'
  }
}

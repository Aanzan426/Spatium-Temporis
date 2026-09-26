/**
 * Recurrence expansion — deliberately tiny (§9).
 *
 * Supported, and nothing more:
 *   - daily
 *   - weekly on selected weekdays
 *   - per-occurrence exceptions (skip this one, move this one)
 *
 * Field shapes stay RRULE-compatible so expanding later isn't a rewrite. There is NO
 * RRULE parser here and there is not going to be one. Full recurrence has consumed
 * entire calendar projects.
 *
 * THE RULE THAT MAKES REVISIONS HONEST (§5.5):
 *   Past occurrences are materialized rows. Future occurrences are generated from the
 *   rule. Changing "gym Mon/Wed/Fri" to "gym Tue/Thu" must leave last month showing
 *   Mon/Wed/Fri — that is what actually happened. Generating the past from the current
 *   rule silently rewrites personal history.
 *
 * `expand()` below enforces that rule *structurally* rather than by convention: it
 * takes a `frozenBefore` boundary and refuses to emit a projection on or before it.
 * There is no way to ask this module for a generated past.
 */

import { addDays, atMinutes, localMidnight, weekday } from './time'
import type { Millis, ProjectedOccurrence, Recurrence } from './types'

/** Safety valve. A ten-year open-ended daily rule is 3,652 dates; nothing needs more. */
const MAX_PROJECTIONS = 20_000

export interface ExpandRange {
  /** Inclusive, snapped down to local midnight. */
  from: Millis
  /** Exclusive. */
  to: Millis
  /**
   * The past/future boundary. Nothing at or before this is projected — that territory
   * belongs to materialized rows (§5.5). Normally `localMidnight(now())`.
   */
  frozenBefore: Millis
}

/** Does this rule fire on the day `dateMs` (local midnight) belongs to? */
export function firesOn(rule: Recurrence, dateMs: Millis): boolean {
  const day = localMidnight(dateMs)
  if (day < localMidnight(rule.from_ms)) return false
  if (rule.until_ms !== null && day > localMidnight(rule.until_ms)) return false
  if (rule.kind === 'daily') return true
  return (rule.weekdays ?? []).includes(weekday(day))
}

/**
 * Project a rule across a range. Returns local-midnight dates, ascending.
 *
 * Stepping is calendar-aware (`addDays`), not `+ 86400000` — across a DST boundary the
 * arithmetic version drifts an hour and then silently skips or repeats a day (§5.7).
 */
export function expand(rule: Recurrence, range: ExpandRange): ProjectedOccurrence[] {
  const out: ProjectedOccurrence[] = []
  const floor = Math.max(localMidnight(range.from), localMidnight(range.frozenBefore) + 1)
  let day = localMidnight(floor)
  if (day < floor) day = addDays(day, 1)

  for (let guard = 0; day < range.to && guard < MAX_PROJECTIONS; guard++) {
    if (firesOn(rule, day)) {
      out.push({
        key: projectedKey(rule.node_id, day),
        node_id: rule.node_id,
        date_ms: day,
        start_ms: atMinutes(day, rule.start_min),
        end_ms: atMinutes(day, rule.end_min),
        projected: true,
      })
    }
    day = addDays(day, 1)
  }
  return out
}

/**
 * Deterministic and derivable from the rule alone, which is what makes a projection
 * suppressible by a materialized row: the store drops any projection whose
 * `(node_id, date_ms)` already exists as an occurrence. A random id could not do that.
 */
export const projectedKey = (nodeId: string, dateMs: Millis): string =>
  `${nodeId}:${dateMs}`

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * The `recurrence` column of the workbook: `daily`, `weekly Mon,Wed,Fri`.
 *
 * Human-readable on purpose — the workbook is a curation surface a person reads. It is
 * never parsed back: the rule is rejoined from the database on `node_id` (SPEC §3.3).
 */
export function describeRecurrence(rule: Recurrence | null | undefined): string {
  if (!rule) return ''
  if (rule.kind === 'daily') return 'daily'
  const days = (rule.weekdays ?? []).slice().sort((a, b) => a - b)
  if (days.length === 0) return 'weekly'
  // Render Monday-first, matching how the fold grid reads.
  const ordered = [...days.filter((d) => d !== 0), ...days.filter((d) => d === 0)]
  return `weekly ${ordered.map((d) => DAY_NAMES[d]).join(',')}`
}

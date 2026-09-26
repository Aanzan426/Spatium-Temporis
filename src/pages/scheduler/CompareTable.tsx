/**
 * Side-by-side revision comparison, the way phone or car models are compared.
 *
 *   columns = revisions      rows = slots      cells = contents
 *
 * Unchanged rows dim; changed cells are emphasised. Horizontal scroll past ~7 columns.
 * "Mon 6am: gym / gym / — / run" reads straight across.
 *
 * A spec sheet beats small multiples here because a schedule is discrete and
 * enumerable rather than continuous. (Small multiples are still right for the strip —
 * different question: "what shape was this week" versus "what changed in this slot".)
 *
 * DO NOT overlay colored schedules on one grid: readable at 2, mushy at 3, noise at 7,
 * and hue is already spent on category. Columns differentiate by position, which costs
 * no color budget (§9).
 *
 * The 2-way diff (green/amber/red, a palette reserved and never used for categories)
 * is a fast follow on this same table.
 *
 * WHAT A "SLOT" IS, AND WHY IT ISN'T A BLOCK
 * ------------------------------------------
 * A row has to exist even in the revisions where nothing is scheduled there — that
 * empty cell is the entire point, it is how a removal becomes visible. So rows are keyed
 * by `weekday + start time`, the union across every column, and a block is looked up
 * into a row rather than being one.
 */

import { useMemo } from 'react'
import { fmtDate } from '../../core/time'
import type { Millis } from '../../core/types'
import type { Miniature } from './RevisionStrip'

export interface CompareTableProps {
  revisions: readonly Miniature[]
  /** Past this many columns the table scrolls rather than shrinking (§9). */
  maxColumns?: number
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

interface Row {
  key: string
  day: number
  minute: number
  label: string
  cells: (string | null)[]
  changed: boolean
}

export function CompareTable({ revisions, maxColumns = 7 }: CompareTableProps) {
  const columns = revisions.slice(-maxColumns)
  const rows = useMemo(() => buildRows(columns), [columns])

  if (columns.length < 2) {
    return (
      <section className="compare empty">
        <p>two or more revisions to compare</p>
      </section>
    )
  }

  return (
    <section className="compare">
      <header className="compare-head">
        <h2>Compare</h2>
        <span className="hint">
          {rows.filter((r) => r.changed).length} of {rows.length} slots changed
        </span>
      </header>

      <div className="compare-scroll">
        <table>
          <thead>
            <tr>
              <th className="slot-col">slot</th>
              {columns.map((c) => (
                <th key={c.id}>{c.label ?? fmtDate(c.ts)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.changed ? 'changed' : 'unchanged'}>
                <th className="slot-col">{row.label}</th>
                {row.cells.map((cell, i) => {
                  // Emphasis is per *cell*: the one that differs from its left neighbour.
                  // Highlighting the whole row would say "something changed here" when
                  // the useful claim is "it changed at this revision".
                  const differs = i > 0 && cell !== row.cells[i - 1]
                  return (
                    <td key={i} className={differs ? 'diff' : ''}>
                      {cell ?? '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function buildRows(columns: readonly Miniature[]): Row[] {
  const slots = new Map<string, { day: number; minute: number }>()

  const cellFor = (col: Miniature, day: number, minute: number): string | null => {
    const found = col.blocks.find(
      (b) => dayIndex(b.date_ms) === day && minuteOf(b) === minute,
    )
    return found ? (col.nodes.get(found.node_id)?.title ?? found.node_id) : null
  }

  for (const col of columns) {
    for (const b of col.blocks) {
      const day = dayIndex(b.date_ms)
      const minute = minuteOf(b)
      slots.set(`${day}:${minute}`, { day, minute })
    }
  }

  return [...slots.entries()]
    .map(([key, { day, minute }]): Row => {
      const cells = columns.map((col) => cellFor(col, day, minute))
      return {
        key,
        day,
        minute,
        label: `${DAY_NAMES[day] ?? '?'} ${hhmm(minute)}`,
        cells,
        changed: cells.some((c, i) => i > 0 && c !== cells[i - 1]),
      }
    })
    .sort((a, b) => a.day - b.day || a.minute - b.minute)
}

/** Monday-first, matching the fold grid. */
const dayIndex = (dateMs: Millis): number => (new Date(dateMs).getDay() + 6) % 7

const minuteOf = (b: { start_ms: Millis | null; date_ms: Millis }): number =>
  b.start_ms === null ? 0 : Math.round((b.start_ms - b.date_ms) / 60_000)

const hhmm = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

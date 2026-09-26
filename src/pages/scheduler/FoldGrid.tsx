/**
 * The scheduler is THE TIMELINE FOLDED ON A CYCLE (§8).
 *
 * Week or month is a single parameter — the fold cycle — not two implementations.
 * Same rule as the zoom bands: one mechanism, parameterised. Concretely, the only
 * difference between the two modes in this file is `FOLDS[cycle]`, five lines of data:
 * how many columns, what to call them, and which column a date lands in.
 *
 * Occurrences generated here also render as bars on the main timeline. Two
 * projections, one dataset — this component never queries; it is handed blocks.
 *
 * DOM, NOT CANVAS — AND WHY THAT ISN'T A CONTRADICTION
 * -----------------------------------------------------
 * The main timeline is canvas because it draws thousands of ticks at arbitrary
 * positions (§6). A week fold is at most a few dozen boxes on a fixed grid: that is
 * what CSS grid is for, and it brings text selection, focus and hit-testing for free.
 * The rule was never "canvas everywhere", it was "canvas where the element count is
 * unbounded".
 */

import { addDays, fmt, localMidnight, weekday } from '../../core/time'
import type { Block, Millis, Node } from '../../core/types'
import { isProjected } from '../../core/types'

export type FoldCycle = 'week' | 'month'

interface Fold {
  columns: number
  /** Which column a date falls in. */
  columnOf: (dateMs: Millis) => number
  /** Heading for a column, given the cycle's anchor. */
  label: (index: number, anchor: Millis) => string
}

/**
 * The whole of the week/month difference. Adding a fortnight fold, or a year folded on
 * months, is one more entry here and no new rendering code.
 */
const FOLDS: Record<FoldCycle, Fold> = {
  week: {
    columns: 7,
    // Monday-first: a schedule reads Mon–Sun, and `weekday()` is Sunday-first.
    columnOf: (ms) => (weekday(ms) + 6) % 7,
    label: (i, anchor) => fmt(addDays(anchor, i), 'EEE'),
  },
  month: {
    columns: 31,
    columnOf: (ms) => new Date(ms).getDate() - 1,
    label: (i) => String(i + 1),
  },
}

export interface FoldGridProps {
  cycle: FoldCycle
  /** First day of the cycle being shown. */
  anchor: Millis
  blocks: readonly Block[]
  nodes: (id: string) => Node | undefined
  /** Read-only and dimmed, for the "as of" view. */
  historical?: boolean
  selectedKey?: string | null
  onPick?: (block: Block) => void
}

/** Minutes past midnight → fraction down the column. A day is 1440 minutes. */
const DAY_MINUTES = 1440

export function FoldGrid({
  cycle,
  anchor,
  blocks,
  nodes,
  historical = false,
  selectedKey = null,
  onPick,
}: FoldGridProps) {
  const fold = FOLDS[cycle]
  const columns = Array.from({ length: fold.columns }, (_, i) => i)

  // Bucket once rather than filtering per column: with a month fold that is 31 passes
  // over every block, which is the kind of thing that is fine until it isn't.
  const byColumn = new Map<number, Block[]>()
  for (const b of blocks) {
    const col = fold.columnOf(b.date_ms)
    const list = byColumn.get(col)
    if (list) list.push(b)
    else byColumn.set(col, [b])
  }

  return (
    <div className={`fold${historical ? ' historical' : ''}`} data-cycle={cycle}>
      <div className="fold-grid" style={{ gridTemplateColumns: `repeat(${fold.columns}, 1fr)` }}>
        {columns.map((i) => (
          <div className="fold-col-head" key={`h${i}`}>
            {fold.label(i, anchor)}
          </div>
        ))}

        {columns.map((i) => (
          <div className="fold-col" key={`c${i}`}>
            {(byColumn.get(i) ?? []).map((block) => {
              const node = nodes(block.node_id)
              const key = isProjected(block) ? block.key : block.id
              const startMin = minutesInto(block.start_ms, block.date_ms)
              const endMin = minutesInto(block.end_ms, block.date_ms) ?? (startMin ?? 0) + 45
              const top = ((startMin ?? 0) / DAY_MINUTES) * 100
              const height = Math.max(((endMin - (startMin ?? 0)) / DAY_MINUTES) * 100, 1.6)

              return (
                <button
                  key={key}
                  className={[
                    'block',
                    isProjected(block) ? 'projected' : 'frozen',
                    selectedKey === key ? 'selected' : '',
                    block.projected !== true && block.outcome ? `outcome-${block.outcome}` : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    top: `${top}%`,
                    height: `${height}%`,
                    background: node?.color ?? '#7aa2f7',
                  }}
                  title={`${node?.title ?? block.node_id}${
                    isProjected(block) ? ' (projected)' : ''
                  }`}
                  disabled={historical}
                  onClick={() => onPick?.(block)}
                >
                  <span className="block-label">{node?.title ?? '—'}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <footer className="fold-legend">
        <span className="swatch frozen" /> materialized
        <span className="swatch projected" /> projected from the rule
        {historical && <span className="hint">read-only — replayed from the event log</span>}
      </footer>
    </div>
  )
}

/**
 * Minutes from the block's own local midnight, not from a UTC day: `date_ms` is local
 * midnight by definition (§5.7), so subtracting it is the one safe arithmetic here.
 */
function minutesInto(ms: Millis | null, dateMs: Millis): number | null {
  if (ms === null) return null
  return Math.round((ms - localMidnight(dateMs)) / 60_000)
}

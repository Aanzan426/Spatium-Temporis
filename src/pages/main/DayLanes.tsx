/**
 * Click a day -> every span crossing it appears as a horizontal lane -> select one to
 * act on, or none.
 *
 * This is also the seed of layers 2 and 3 (§10). The interaction pattern is meant to
 * stay consistent when it grows, so lane selection is generic over "things crossing a
 * point in time" rather than special-cased to tasks — `items` below is computed by one
 * range query and nothing in here knows what a task is.
 *
 * Note what it deliberately does not do: it does not filter by magnitude. The timeline
 * hides a tera-goal at day zoom because rendering everything at every scale is noise
 * (§4) — but you clicked this specific day and asked what crosses it, and an answer
 * that silently omitted the decade-long thing running through it would be a lie.
 */

import { localDayEnd, localMidnight, fmtAtPrecision, fmtDate } from '../../core/time'
import type { Millis, Node } from '../../core/types'
import { useQuery } from '../../store/useStore'

export interface DayLanesProps {
  day: Millis | null
  selectedId?: string | null
  onSelect?: (node: Node | null) => void
}

export function DayLanes({ day, selectedId, onSelect }: DayLanesProps) {
  const items = useQuery(
    (s) => (day === null ? [] : s.spansInRange(localMidnight(day), localDayEnd(day))),
    [day],
  )

  if (day === null) {
    return (
      <section className="lanes empty">
        <p>click a day on the timeline</p>
      </section>
    )
  }

  return (
    <section className="lanes">
      <header className="lanes-head">
        <h2>{fmtDate(day)}</h2>
        <span className="hint">
          {items.length} crossing
          {/* "or none" — clicking the day again clears the selection, which is what
              makes the pattern safe to grow into layers 2 and 3. */}
          {selectedId && (
            <button className="link" onClick={() => onSelect?.(null)}>
              clear
            </button>
          )}
        </span>
      </header>

      <ul className="lane-list">
        {items.map(({ node, span }) => (
          <li
            key={node.id}
            className={`lane${selectedId === node.id ? ' selected' : ''}${
              node.status === 'abandoned' ? ' dim' : ''
            }`}
            onClick={() => onSelect?.(node)}
          >
            <span className="swatch" style={{ background: node.color ?? '#7aa2f7' }} />
            <span className="lane-title">{node.title}</span>
            <span className="lane-meta">
              {node.magnitude ?? 'unsized'}{'  '}
              {span.start_ms === null
                ? 'undated'
                : fmtAtPrecision(span.start_ms, span.start_precision)}
              {span.end_ms !== null && span.end_ms !== span.start_ms
                ? ` → ${fmtAtPrecision(span.end_ms, span.end_precision)}`
                : ''}
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="empty">nothing crosses this day</li>}
      </ul>
    </section>
  )
}

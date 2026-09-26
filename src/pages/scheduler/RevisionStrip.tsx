/**
 * Menu -> Revisions. A horizontally scrolling strip of every committed revision.
 *
 * Nothing is merged or hidden: if a timing changed, a revision exists for it. The one
 * distinction is that a revision is a COMMITTED change, not an input frame — a
 * two-second drag is one revision on release (§9).
 *
 * PERFORMANCE, when this renders N miniatures: the naive approach replays the event
 * log independently per card and crawls once N is 7 and the log is months long.
 * Replay ONCE, forward, snapshotting state at each revision boundary as you pass it.
 * One pass, N snapshots, then draw — same total work as rendering a single revision.
 * That is `replayAt` in `store/events.ts`, and it is the only reason this component
 * does not call `store.stateAt()` in a loop, which is the obvious and wrong thing.
 *
 * Each card is a LIVE MINIATURE of the actual week grid, not a label — this is small
 * multiples, the correct visualization for comparing many versions: identical scale,
 * repeated form, differences caught by eye without reading anything.
 *
 * A revision's optional `label` names the revision window it opens. Windows need no
 * table: a window is the interval between two consecutive revisions (§9).
 */

import { useMemo } from 'react'
import { addDays, fmtDate, localMidnight, localWeekStart } from '../../core/time'
import type { Block, Event, Millis, Node } from '../../core/types'
import { replayAt } from '../../store/events'
import { blocksIn } from '../../store/projection'
import { useQuery, useStore } from '../../store/useStore'

export interface RevisionStripProps {
  scope: string
  /** Which week each miniature shows. The same week for all, so they are comparable. */
  weekOf: Millis
  selectedId?: string | null
  onSelect?: (revisionId: string | null) => void
}

export interface Miniature {
  id: string
  ts: Millis
  label: string | null
  blocks: Block[]
  nodes: Map<string, Node>
}

export function RevisionStrip({ scope, weekOf, selectedId, onSelect }: RevisionStripProps) {
  const store = useStore()
  const revisions = useQuery((s) => s.listRevisions(scope), [scope])
  const events = useQuery((s) => s.allEvents())

  const cards = useMemo(
    () => miniatures(events, revisions, weekOf),
    [events, revisions, weekOf],
  )

  return (
    <section className="strip">
      <header className="strip-head">
        <h2>Revisions</h2>
        <span className="hint">
          {cards.length} committed · week of {fmtDate(localWeekStart(weekOf))}
          {selectedId && (
            <button className="link" onClick={() => onSelect?.(null)}>
              back to now
            </button>
          )}
        </span>
      </header>

      <div className="strip-rail">
        {cards.map((card) => (
          <button
            key={card.id}
            className={`card${selectedId === card.id ? ' selected' : ''}`}
            onClick={() => onSelect?.(card.id)}
          >
            <Thumb card={card} weekOf={weekOf} />
            <span className="card-label">{card.label ?? fmtDate(card.ts)}</span>
            <span className="card-meta">{card.blocks.length} blocks</span>
          </button>
        ))}
        {cards.length === 0 && <p className="empty">no revisions yet — change something</p>}
      </div>

      <p className="hint">
        naming a revision names the window it opens:{' '}
        <button
          className="link"
          onClick={() => {
            const label = window.prompt('name this revision window')
            if (label && selectedId) store.labelRevision(selectedId, label)
          }}
          disabled={!selectedId}
        >
          label selected
        </button>
      </p>
    </section>
  )
}

/**
 * ONE forward pass over the log, N snapshots. See the header — this function is the
 * whole performance note.
 */
export function miniatures(
  events: readonly Event[],
  revisions: readonly { id: string; ts: Millis; label: string | null }[],
  weekOf: Millis,
): Miniature[] {
  const from = localWeekStart(weekOf)
  const to = addDays(from, 7)
  const worlds = replayAt(events, revisions.map((r) => r.ts))

  return revisions.map((rev, i) => {
    const world = worlds[i]!
    return {
      id: rev.id,
      ts: rev.ts,
      label: rev.label,
      nodes: world.nodes,
      // Frozen at the revision's own date, not today: an "as of" view must show what
      // was planned *then*, which means the past/future boundary moves with it (§5.5).
      blocks: blocksIn(
        { occurrences: world.occurrences.values(), recurrences: world.recurrences.values() },
        { from, to, frozenBefore: localMidnight(rev.ts) },
      ),
    }
  })
}

/**
 * The miniature itself: the same week, the same geometry, at a size where only the
 * *shape* of the schedule is readable. That is the point of small multiples — you are
 * meant to compare silhouettes, not read labels.
 */
function Thumb({ card, weekOf }: { card: Miniature; weekOf: Millis }) {
  const from = localWeekStart(weekOf)
  return (
    <span className="thumb">
      {Array.from({ length: 7 }, (_, day) => {
        const dayStart = addDays(from, day)
        const blocks = card.blocks.filter((b) => b.date_ms === dayStart)
        return (
          <span className="thumb-col" key={day}>
            {blocks.map((b) => {
              const node = card.nodes.get(b.node_id)
              const startMin = b.start_ms === null ? 0 : (b.start_ms - b.date_ms) / 60_000
              const endMin = b.end_ms === null ? startMin + 45 : (b.end_ms - b.date_ms) / 60_000
              return (
                <span
                  key={`${b.node_id}:${b.date_ms}`}
                  className="thumb-block"
                  style={{
                    top: `${(startMin / 1440) * 100}%`,
                    height: `${Math.max(((endMin - startMin) / 1440) * 100, 2)}%`,
                    background: node?.color ?? '#7aa2f7',
                  }}
                />
              )
            })}
          </span>
        )
      })}
    </span>
  )
}

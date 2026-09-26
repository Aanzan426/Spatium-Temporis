/**
 * Scheduler page — answers WHAT DOES A TYPICAL WEEK LOOK LIKE.
 *
 * A schedule is a FRAMEWORK: a structure, versioned, comparatively stable. What
 * actually happened is the volatile layer and belongs to Phase 2 (§9) — so there is no
 * outcome control on this page, even though `setOutcome` exists and the columns are
 * already there.
 *
 * Composes: FoldGrid + RevisionStrip + CompareTable + the "as of" scrubber.
 *
 * THE SCRUBBER IS A TIME CONTROL, NOT A HISTORY CONTROL
 * -----------------------------------------------------
 * Drag it back and the grid replays the event log to that date and renders how it
 * looked then, read-only and dimmed — the same mental model as panning the main
 * timeline, which is the point. It is not a list of versions to open; it is the same
 * week, at a different time.
 *
 * Both the scrubber and the strip are the same replay underneath (§9). The strip is
 * "show me all of them at once"; the scrubber is "put me back there".
 */

import { useMemo, useState } from 'react'
import { addDays, addWeeks, fmtDate, localMidnight, localWeekStart, now } from '../../core/time'
import type { Block, Millis } from '../../core/types'
import { blocksIn } from '../../store/projection'
import { useQuery, useStore } from '../../store/useStore'
import { CompareTable } from './CompareTable'
import { FoldGrid } from './FoldGrid'
import type { FoldCycle } from './FoldGrid'
import { RevisionStrip, miniatures } from './RevisionStrip'

const SCOPE = 'scheduler'

export function SchedulerPage() {
  const store = useStore()
  const nowMs = useMemo(() => now(), [])
  const [cycle, setCycle] = useState<FoldCycle>('week')
  const [anchor, setAnchor] = useState<Millis>(() => localWeekStart(nowMs))
  /** null = live. A timestamp = replayed, read-only (§9). */
  const [asOf, setAsOf] = useState<Millis | null>(null)
  const [selectedRevision, setSelectedRevision] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const from = anchor
  const to = cycle === 'week' ? addDays(anchor, 7) : addDays(anchor, 31)

  const live = useQuery((s) => s.blocksInRange(from, to), [from, to])
  const nodesById = useQuery((s) => new Map(s.listNodes().map((n) => [n.id, n])), [])
  const events = useQuery((s) => s.allEvents())
  const revisions = useQuery((s) => s.listRevisions(SCOPE))

  /**
   * The replayed view. Note `frozenBefore: asOf` — the past/future boundary travels
   * with the scrubber, so a week that was entirely future then renders as projections
   * now, exactly as it did at the time (§5.5). Freezing at today instead would show a
   * past that had already been materialized, which is a different and wrong answer.
   */
  const historical: { blocks: Block[]; nodes: Map<string, unknown> } | null = useMemo(() => {
    if (asOf === null) return null
    const world = store.replayTo(asOf)
    return {
      blocks: blocksIn(
        { occurrences: world.occurrences.values(), recurrences: world.recurrences.values() },
        { from, to, frozenBefore: localMidnight(asOf) },
      ),
      nodes: world.nodes,
    }
  }, [asOf, from, to, store])

  const blocks = historical?.blocks ?? live
  const lookup = (id: string) =>
    (historical
      ? (historical.nodes as Map<string, ReturnType<typeof store.getNode>>).get(id)
      : nodesById.get(id)) ?? undefined

  const cards = useMemo(
    () => miniatures(events, revisions, anchor),
    [events, revisions, anchor],
  )

  // The scrubber's travel: first event to now.
  const firstTs = events.length ? events[0]!.ts : nowMs
  const scrub = asOf ?? nowMs

  return (
    <div className="page scheduler-page">
      <div className="toolbar">
        <button onClick={() => setAnchor((a) => addWeeks(a, -1))}>←</button>
        <button onClick={() => setAnchor(localWeekStart(nowMs))}>this week</button>
        <button onClick={() => setAnchor((a) => addWeeks(a, 1))}>→</button>

        <select value={cycle} onChange={(e) => setCycle(e.target.value as FoldCycle)}>
          <option value="week">fold: week</option>
          <option value="month">fold: month</option>
        </select>

        <button
          onClick={() => {
            const label = window.prompt('name this revision (optional)') || null
            store.markRevision(SCOPE, label, true)
          }}
        >
          mark revision
        </button>

        <span className="hint">{fmtDate(anchor)}</span>
      </div>

      <div className={`scrubber${asOf === null ? '' : ' active'}`}>
        <label>
          as of
          <input
            type="range"
            min={firstTs}
            max={nowMs}
            step={3_600_000}
            value={scrub}
            onChange={(e) => {
              const v = Number(e.target.value)
              setAsOf(v >= nowMs - 3_600_000 ? null : v)
            }}
          />
        </label>
        <span className="hint">
          {asOf === null ? 'live' : `${fmtDate(asOf)} — replayed, read-only`}
        </span>
        {asOf !== null && (
          <button className="link" onClick={() => setAsOf(null)}>
            back to now
          </button>
        )}
      </div>

      <FoldGrid
        cycle={cycle}
        anchor={anchor}
        blocks={blocks}
        nodes={lookup}
        historical={asOf !== null}
        selectedKey={selectedKey}
        onPick={(b) => setSelectedKey(b.projected ? b.key : b.id)}
      />

      <RevisionStrip
        scope={SCOPE}
        weekOf={anchor}
        selectedId={selectedRevision}
        onSelect={(id) => {
          setSelectedRevision(id)
          const rev = revisions.find((r) => r.id === id)
          setAsOf(rev ? rev.ts : null)
        }}
      />

      <CompareTable revisions={cards} />
    </div>
  )
}

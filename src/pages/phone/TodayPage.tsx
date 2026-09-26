/**
 * The phone's main view: what is on today, and what is still unanswered.
 *
 * §7's split holds — phone captures, desktop structures and visualizes. This is not a
 * small timeline; there is no camera, no zoom and no graph here, because none of them
 * are usable at 390px and none of them are what you open a phone for. What the phone
 * owns is the work that is time-critical: an answer that only exists honestly for about
 * two minutes after a block ends.
 *
 * THE ORDER OF THE PAGE IS THE ARGUMENT
 * -------------------------------------
 * Outstanding blocks come first, before today's schedule, because they are the only
 * thing here with a deadline. Everything below them is reference.
 */

import { useMemo, useState } from 'react'
import { outstanding, recordOutcome } from '../../alarms/alarms'
import { fmtTime, localMidnight, now } from '../../core/time'
import type { Block, Outcome } from '../../core/types'
import { blockKey, isProjected } from '../../core/types'
import { useQuery, useStore } from '../../store/useStore'

export function TodayPage({ alarmsAvailable }: { alarmsAvailable: boolean }) {
  const store = useStore()
  const nowMs = useMemo(() => now(), [])
  const [answering, setAnswering] = useState<Block | null>(null)

  const pending = useQuery((s) => outstanding(s, nowMs), [nowMs])
  const today = useQuery(
    (s) => s.blocksInRange(localMidnight(nowMs), localMidnight(nowMs) + 86_400_000),
    [nowMs],
  )
  const nodes = useQuery((s) => new Map(s.listNodes().map((n) => [n.id, n])))

  return (
    <div className="phone-page">
      {pending.length > 0 && (
        <section className="pending">
          <h2>Still open</h2>
          <ul>
            {pending.map((block) => (
              <li key={blockKey(block)}>
                <div className="row">
                  <span className="when">{block.end_ms ? fmtTime(block.end_ms) : ''}</span>
                  <span className="what">{nodes.get(block.node_id)?.title ?? '—'}</span>
                </div>
                <div className="answers">
                  {/*
                    Done is one tap and closes it. The other two open the follow-ups,
                    because a miss needs a reason and a "what now" — and "what now"
                    creates a node, not a string (§9).
                  */}
                  <button
                    className="answer done"
                    onClick={() => recordOutcome(store, block, 'done')}
                  >
                    Done
                  </button>
                  <button className="answer partial" onClick={() => setAnswering(block)}>
                    Partly
                  </button>
                  <button className="answer missed" onClick={() => setAnswering(block)}>
                    Missed
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="today">
        <h2>Today</h2>
        <ul>
          {today.map((block) => {
            const node = nodes.get(block.node_id)
            const answered = !isProjected(block) && block.outcome !== null
            return (
              <li key={blockKey(block)} className={answered ? `answered ${block.outcome}` : ''}>
                <span className="when">
                  {block.start_ms ? fmtTime(block.start_ms) : '—'}
                </span>
                <span className="swatch" style={{ background: node?.color ?? '#7aa2f7' }} />
                <span className="what">{node?.title ?? '—'}</span>
                {answered && <span className="mark">{(block as { outcome: Outcome }).outcome}</span>}
              </li>
            )
          })}
          {today.length === 0 && <li className="empty">nothing scheduled</li>}
        </ul>
      </section>

      {!alarmsAvailable && (
        // Stated plainly rather than hidden: without notifications, outcomes depend on
        // opening the app, and the user should know their record is only as prompt as
        // their habit.
        <p className="notice">
          Notifications are off, so nothing will prompt you when a block ends. Answers
          given later are still recorded — and marked with when they were given.
        </p>
      )}

      {answering && (
        <OutcomeSheet
          block={answering}
          title={nodes.get(answering.node_id)?.title ?? ''}
          onClose={() => setAnswering(null)}
        />
      )}
    </div>
  )
}

/**
 * The two follow-ups for a miss: **why**, and **what now**.
 *
 * "What now" is a node with an edge back to the occurrence that failed, which is what
 * yields causal chains — *when this gets missed, this is what happens next*. A text
 * field would have been half the work and none of the value.
 */
function OutcomeSheet({
  block,
  title,
  onClose,
}: {
  block: Block
  title: string
  onClose: () => void
}) {
  const store = useStore()
  const [outcome, setOutcome] = useState<Outcome>('skipped')
  const [reason, setReason] = useState('')
  const [followUp, setFollowUp] = useState('')

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>

        <div className="segmented">
          {(['partial', 'skipped', 'moved'] as const).map((o) => (
            <button
              key={o}
              className={outcome === o ? 'on' : ''}
              onClick={() => setOutcome(o)}
            >
              {o === 'partial' ? 'Partly' : o === 'skipped' ? 'Missed' : 'Moved'}
            </button>
          ))}
        </div>

        <label>
          What got in the way?
          <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </label>

        <label>
          What now?
          <input
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            placeholder="becomes a linked node"
          />
        </label>

        <div className="sheet-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              recordOutcome(store, block, outcome, { reason, followUpTitle: followUp })
              onClose()
            }}
          >
            Record
          </button>
        </div>
      </div>
    </div>
  )
}

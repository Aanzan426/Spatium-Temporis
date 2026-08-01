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
 *
 * A revision's optional `label` names the period it opens. Periods need no table: a
 * period is simply the interval between two consecutive revisions (§9).
 */
export function RevisionStrip() {
  return <div>revisions</div>
}

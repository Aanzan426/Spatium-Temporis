/**
 * The append-only event log. Every mutation writes here (§5.3).
 *
 * This is the training corpus for the apprentice model, and the source of every
 * revision view. Current state alone teaches a model nothing; the signal is in the
 * changes — how plans get re-cut, what links to what, what gets abandoned.
 *
 * PAYLOADS MUST BE REPLAYABLE (§5.4):
 *   BAD   { kind: 'span_changed', node_id: 'x' }              <- records nothing
 *   GOOD  { kind: 'span_changed', node_id: 'x',
 *           before: { start_ms, end_ms }, after: { start_ms, end_ms } }
 *
 * One write then buys revision replay, undo, and an explicit delta for training.
 * This failure is invisible until the day the data is needed and isn't there.
 *
 * A revision is one COMMITTED change, not one input frame. A two-second drag is a
 * single event on release, not 120 at 60fps.
 *
 * Write a throwaway script that replays the whole log and asserts the result equals
 * current state. Ten minutes, and it is the difference between having a revision
 * feature and thinking you have one.
 */
export {}

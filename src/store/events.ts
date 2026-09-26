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
 * WHY `before`/`after` ARE WHOLE ROWS AND NOT MINIMAL DIFFS
 * --------------------------------------------------------
 * A minimal diff is a smaller file and a much more fragile one: replay then depends on
 * every prior event having been applied correctly, so a single malformed payload
 * anywhere in the log corrupts every state after it. Whole rows make each event
 * independently applicable — replay is `set(after)`, and a bad event damages exactly
 * one row at one timestamp. At personal scale the size difference is irrelevant and the
 * robustness difference is the whole feature. `changedFields()` below recovers the
 * minimal diff on demand, for display and for training, without the log depending on it.
 *
 * A revision is one COMMITTED change, not one input frame. A two-second drag is a
 * single event on release, not 120 at 60fps.
 */

import { deviceIdentity } from '../core/device'
import { newId } from '../core/ids'
import type {
  Edge,
  Event,
  EventKind,
  EventPayload,
  Id,
  Millis,
  Node,
  NodeType,
  Occurrence,
  Recurrence,
  Revision,
  Span,
} from '../core/types'

export type EventTarget = NonNullable<EventPayload['target']>

export interface AppendInput {
  kind: EventKind
  node_id: Id | null
  target: EventTarget
  target_id?: Id
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  note?: string
  /** Explicit timestamp, for deterministic fixtures and tests. Defaults to now. */
  ts?: Millis
}

export function makeEvent(input: AppendInput): Event {
  const ts = input.ts ?? Date.now()
  const device = deviceIdentity()
  return {
    id: newId(ts),
    ts,
    node_id: input.node_id,
    kind: input.kind,
    device_id: device.id,
    device_kind: device.kind,
    payload: {
      before: input.before,
      after: input.after,
      target: input.target,
      ...(input.target_id ? { target_id: input.target_id } : {}),
      ...(input.note ? { note: input.note } : {}),
    },
  }
}

/** A defensive copy, so a later mutation of the live row cannot rewrite history. */
export const snap = <T extends object>(row: T | null | undefined): Record<string, unknown> | null =>
  row ? (JSON.parse(JSON.stringify(row)) as Record<string, unknown>) : null

/**
 * The minimal diff, recovered from the whole-row payload. Display and training use
 * this; replay never does.
 */
export function changedFields(e: Event): string[] {
  const { before, after } = e.payload
  if (!before) return after ? Object.keys(after) : []
  if (!after) return Object.keys(before)
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort()
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * Everything the log can reconstruct. Deliberately the same shape the stores hold
 * internally, so "replay the log" and "read the tables" are comparable object-for-object
 * — which is what makes the round-trip assertion in `tools/replay-check.ts` meaningful.
 */
export interface WorldState {
  nodes: Map<Id, Node>
  /** Keyed by `node_id`: a node has at most one span. */
  spans: Map<Id, Span>
  edges: Map<Id, Edge>
  /** Keyed by `node_id`: a node has at most one recurrence rule. */
  recurrences: Map<Id, Recurrence>
  occurrences: Map<Id, Occurrence>
  nodeTypes: Map<string, NodeType>
  revisions: Map<Id, Revision>
}

export const emptyWorld = (): WorldState => ({
  nodes: new Map(),
  spans: new Map(),
  edges: new Map(),
  recurrences: new Map(),
  occurrences: new Map(),
  nodeTypes: new Map(),
  revisions: new Map(),
})

const cloneWorld = (w: WorldState): WorldState => ({
  nodes: new Map(w.nodes),
  spans: new Map(w.spans),
  edges: new Map(w.edges),
  recurrences: new Map(w.recurrences),
  occurrences: new Map(w.occurrences),
  nodeTypes: new Map(w.nodeTypes),
  revisions: new Map(w.revisions),
})

/** Which collection a target lives in, and what keys it by. */
function applyOne(world: WorldState, e: Event): void {
  const { target, after, before } = e.payload
  switch (target) {
    case 'node': {
      if (after) world.nodes.set(after.id as Id, after as unknown as Node)
      break
    }
    case 'span': {
      if (after) world.spans.set(after.node_id as Id, after as unknown as Span)
      else if (before) world.spans.delete(before.node_id as Id)
      break
    }
    case 'edge': {
      // The one thing that is genuinely removed: unlinking is not deletion of a node.
      if (after) world.edges.set(after.id as Id, after as unknown as Edge)
      else if (before) world.edges.delete(before.id as Id)
      break
    }
    case 'recurrence': {
      if (after) world.recurrences.set(after.node_id as Id, after as unknown as Recurrence)
      else if (before) world.recurrences.delete(before.node_id as Id)
      break
    }
    case 'occurrence': {
      if (after) world.occurrences.set(after.id as Id, after as unknown as Occurrence)
      break
    }
    case 'node_type': {
      if (after) world.nodeTypes.set(after.name as string, after as unknown as NodeType)
      break
    }
    case 'revision': {
      if (after) world.revisions.set(after.id as Id, after as unknown as Revision)
      break
    }
    default:
      // An event with no target is a note about history, not a change to it. Ignored by
      // replay on purpose rather than by omission.
      break
  }
}

/** Replay the log up to and including `ts`. Events are assumed ascending by `ts`. */
export function replayTo(events: readonly Event[], ts: Millis): WorldState {
  const world = emptyWorld()
  for (const e of events) {
    if (e.ts > ts) break
    applyOne(world, e)
  }
  return world
}

/**
 * N states in ONE forward pass.
 *
 * The naive `RevisionStrip` replays the whole log independently per card, which is
 * O(N × log) and crawls the moment N is 7 and the log is months long. This walks the
 * log once, snapshotting as it crosses each boundary: O(log + N × state).
 *
 * `boundaries` must be ascending. The returned array is parallel to it.
 */
export function replayAt(events: readonly Event[], boundaries: readonly Millis[]): WorldState[] {
  const out: WorldState[] = []
  const world = emptyWorld()
  let i = 0
  for (const b of boundaries) {
    while (i < events.length && events[i]!.ts <= b) {
      applyOne(world, events[i]!)
      i++
    }
    out.push(cloneWorld(world))
  }
  return out
}

/**
 * In-memory Store implementation. Fake data, no persistence.
 *
 * This is what step 1 runs against so the timeline transform can be built and felt
 * before any database exists. Also the fastest thing to write tests against.
 *
 * It is not a toy: it implements the whole interface, including the event log and
 * replay, because the parts most likely to be wrong (payload completeness, the
 * frozen-past rule) are exactly the parts a stubbed store would let you skip. When
 * `SqliteStore` lands, the two are checked against each other by running the same
 * script over both.
 */

import { newId } from '../../core/ids'
import { describeRecurrence, firesOn, projectedKey } from '../../core/recurrence'
import { addDays, atMinutes, localMidnight, now } from '../../core/time'
import type {
  Block,
  Edge,
  Event,
  Id,
  Millis,
  Node,
  NodePatch,
  NodeType,
  NewNode,
  Occurrence,
  Outcome,
  Recurrence,
  RecurrenceInput,
  Revision,
  RevisionWindow,
  Span,
  SpanInput,
} from '../../core/types'
import type { AppendInput } from '../events'
import { makeEvent, replayTo as replayEvents, snap } from '../events'
import { blocksIn } from '../projection'
import type { DatabaseSnapshot, Dated, Store } from '../Store'

export class MemoryStore implements Store {
  protected nodes = new Map<Id, Node>()
  /** Keyed by node_id — a node has at most one span. */
  protected spans = new Map<Id, Span>()
  protected edges = new Map<Id, Edge>()
  protected events: Event[] = []
  protected recurrences = new Map<Id, Recurrence>()
  protected occurrences = new Map<Id, Occurrence>()
  protected revisions = new Map<Id, Revision>()
  protected nodeTypes = new Map<string, NodeType>()

  private listeners = new Set<() => void>()
  private _version = 0

  // -------------------------------------------------------------------------
  // plumbing
  // -------------------------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  version(): number {
    return this._version
  }

  private commit(...inputs: AppendInput[]): void {
    const appended = inputs.map(makeEvent)
    for (const e of appended) this.events.push(e)
    // Durability BEFORE notification: a subscriber that re-reads must never see state
    // the disk has not accepted.
    this.persist(appended)
    this._version++
    for (const l of this.listeners) l()
  }

  /**
   * Where a durable subclass writes. The hook takes the *events*, not the rows, and
   * that is deliberate: it makes an unlogged write structurally impossible, because
   * persistence has no input other than the log. §5.3 stops being a discipline and
   * becomes a property of the code.
   *
   * No-op here — MemoryStore is the volatile one.
   */
  protected persist(_events: Event[]): void {}

  /**
   * Fill the in-memory maps without logging. The snapshot's events ARE the history;
   * re-logging them on load would double the corpus and shift every timestamp.
   */
  protected hydrate(s: DatabaseSnapshot): void {
    this.nodes = new Map(s.nodes.map((n) => [n.id, n]))
    this.spans = new Map(s.spans.map((sp) => [sp.node_id, sp]))
    this.edges = new Map(s.edges.map((e) => [e.id, e]))
    this.recurrences = new Map(s.recurrences.map((r) => [r.node_id, r]))
    this.occurrences = new Map(s.occurrences.map((o) => [o.id, o]))
    this.revisions = new Map(s.revisions.map((r) => [r.id, r]))
    this.nodeTypes = new Map(s.node_types.map((t) => [t.name, t]))
    this.events = [...s.events].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
  }

  // -------------------------------------------------------------------------
  // nodes
  // -------------------------------------------------------------------------

  getNode(id: Id): Node | undefined {
    return this.nodes.get(id)
  }

  listNodes(): Node[] {
    return [...this.nodes.values()]
  }

  /**
   * A title is the only requirement (§5.1). Everything else defaults to null, including
   * the span — an undated node is a complete node, and that is what the inbox writes.
   */
  createNode(input: NewNode, span?: SpanInput): Node {
    const ts = now()
    const node: Node = {
      id: newId(ts),
      type: input.type ?? null,
      title: input.title,
      body: input.body ?? null,
      status: input.status ?? null,
      magnitude: input.magnitude ?? null,
      color: input.color ?? null,
      attrs: input.attrs ?? {},
      created_at: ts,
      updated_at: ts,
    }
    this.nodes.set(node.id, node)

    const writes: AppendInput[] = [
      { kind: 'created', node_id: node.id, target: 'node', before: null, after: snap(node), ts },
    ]
    if (span) {
      const row = this.writeSpan(node.id, span, ts)
      writes.push({
        kind: 'span_changed', node_id: node.id, target: 'span',
        target_id: row.id, before: null, after: snap(row), ts,
      })
    }
    this.commit(...writes)
    return node
  }

  updateNode(id: Id, patch: NodePatch): Node {
    const before = this.nodes.get(id)
    if (!before) throw new Error(`updateNode: no node ${id}`)
    const after: Node = { ...before, ...patch, updated_at: now() }
    this.nodes.set(id, after)
    this.commit({
      kind: kindForPatch(patch),
      node_id: id,
      target: 'node',
      before: snap(before),
      after: snap(after),
      ts: after.updated_at,
    })
    return after
  }

  // -------------------------------------------------------------------------
  // spans
  // -------------------------------------------------------------------------

  getSpan(nodeId: Id): Span | undefined {
    return this.spans.get(nodeId)
  }

  private writeSpan(nodeId: Id, input: SpanInput, ts: Millis): Span {
    const existing = this.spans.get(nodeId)
    const row: Span = {
      id: existing?.id ?? newId(ts),
      node_id: nodeId,
      start_ms: input.start_ms,
      start_precision: input.start_precision ?? existing?.start_precision ?? 'day',
      end_ms: input.end_ms,
      end_precision: input.end_precision ?? existing?.end_precision ?? 'day',
    }
    this.spans.set(nodeId, row)
    return row
  }

  setSpan(nodeId: Id, input: SpanInput): Span {
    const ts = now()
    const before = snap(this.spans.get(nodeId))
    const row = this.writeSpan(nodeId, input, ts)
    this.commit({
      kind: 'span_changed', node_id: nodeId, target: 'span',
      target_id: row.id, before, after: snap(row), ts,
    })
    return row
  }

  /** Overlap test, not containment: a decade-long goal crossing the viewport counts. */
  spansInRange(from: Millis, to: Millis): Dated[] {
    const out: Dated[] = []
    for (const span of this.spans.values()) {
      const node = this.nodes.get(span.node_id)
      if (!node) continue
      const s = span.start_ms
      const e = span.end_ms ?? span.start_ms
      if (s === null || e === null) continue
      if (e >= from && s < to) out.push({ node, span })
    }
    return out.sort((a, b) => (a.span.start_ms ?? 0) - (b.span.start_ms ?? 0))
  }

  undated(): Node[] {
    return this.listNodes()
      .filter((n) => {
        const span = this.spans.get(n.id)
        return !span || span.start_ms === null
      })
      // ULIDs sort by creation time, so this is recency with no extra column (§5.6).
      .sort((a, b) => b.id.localeCompare(a.id))
  }

  // -------------------------------------------------------------------------
  // edges
  // -------------------------------------------------------------------------

  edgesForNode(id: Id): Edge[] {
    return [...this.edges.values()].filter((e) => e.from_node === id || e.to_node === id)
  }

  link(from: Id, to: Id, relation: string): Edge {
    const ts = now()
    const edge: Edge = { id: newId(ts), from_node: from, to_node: to, relation, created_at: ts }
    this.edges.set(edge.id, edge)
    this.commit({
      kind: 'linked', node_id: from, target: 'edge',
      target_id: edge.id, before: null, after: snap(edge), ts,
    })
    return edge
  }

  unlink(edgeId: Id): void {
    const edge = this.edges.get(edgeId)
    if (!edge) return
    this.edges.delete(edgeId)
    this.commit({
      kind: 'unlinked', node_id: edge.from_node, target: 'edge',
      target_id: edge.id, before: snap(edge), after: null, ts: now(),
    })
  }

  // -------------------------------------------------------------------------
  // events
  // -------------------------------------------------------------------------

  allEvents(): Event[] {
    return [...this.events]
  }

  eventsInRange(from: Millis, to: Millis): Event[] {
    return this.events.filter((e) => e.ts >= from && e.ts < to)
  }

  eventsForNode(id: Id): Event[] {
    return this.events.filter((e) => e.node_id === id)
  }

  replayTo(ts: Millis) {
    return replayEvents(this.events, ts)
  }

  // -------------------------------------------------------------------------
  // recurrence
  // -------------------------------------------------------------------------

  getRecurrence(nodeId: Id): Recurrence | undefined {
    return this.recurrences.get(nodeId)
  }

  listRecurrences(): Recurrence[] {
    return [...this.recurrences.values()]
  }

  setRecurrence(nodeId: Id, input: RecurrenceInput): Recurrence {
    const ts = now()
    const before = this.recurrences.get(nodeId)
    const row: Recurrence = {
      id: before?.id ?? newId(ts),
      node_id: nodeId,
      kind: input.kind,
      weekdays: input.kind === 'weekly' ? (input.weekdays ?? []) : null,
      from_ms: input.from_ms,
      until_ms: input.until_ms ?? null,
      start_min: input.start_min ?? before?.start_min ?? null,
      end_min: input.end_min ?? before?.end_min ?? null,
    }
    this.recurrences.set(nodeId, row)
    this.commit({
      kind: 'recurrence_changed', node_id: nodeId, target: 'recurrence',
      target_id: row.id, before: snap(before), after: snap(row), ts,
      note: describeRecurrence(row),
    })
    return row
  }

  clearRecurrence(nodeId: Id): void {
    const before = this.recurrences.get(nodeId)
    if (!before) return
    this.recurrences.delete(nodeId)
    this.commit({
      kind: 'recurrence_changed', node_id: nodeId, target: 'recurrence',
      target_id: before.id, before: snap(before), after: null, ts: now(),
    })
  }

  // -------------------------------------------------------------------------
  // occurrences
  // -------------------------------------------------------------------------

  listOccurrences(): Occurrence[] {
    return [...this.occurrences.values()].sort((a, b) => a.date_ms - b.date_ms)
  }

  /**
   * The merge that §5.5 describes, in one place: real rows win, projections fill the
   * future. A projection is dropped wherever a materialized row already covers the same
   * `(node_id, date_ms)` — which is also what makes `materializePast` idempotent.
   */
  blocksInRange(from: Millis, to: Millis): Block[] {
    return blocksIn(
      { occurrences: this.occurrences.values(), recurrences: this.recurrences.values() },
      { from, to, frozenBefore: localMidnight(now()) },
    )
  }

  /**
   * Freeze the past. Walks each rule day by day from where it last left off and writes
   * real rows for everything on or before `untilMs`.
   *
   * Idempotent because it skips any `(node_id, date_ms)` that already exists — so
   * calling it on every app open, which is the intent, costs one pass and writes
   * nothing the second time.
   */
  materializePast(untilMs: Millis): number {
    const ts = now()
    const ceiling = localMidnight(untilMs)
    const existing = new Set(
      [...this.occurrences.values()].map((o) => projectedKey(o.node_id, o.date_ms)),
    )
    const writes: AppendInput[] = []

    for (const rule of this.recurrences.values()) {
      let day = localMidnight(rule.from_ms)
      const stop = rule.until_ms === null ? ceiling : Math.min(ceiling, localMidnight(rule.until_ms))
      for (let guard = 0; day <= stop && guard < 20_000; guard++) {
        const key = projectedKey(rule.node_id, day)
        if (firesOn(rule, day) && !existing.has(key)) {
          const row: Occurrence = {
            id: newId(ts),
            node_id: rule.node_id,
            date_ms: day,
            start_ms: atMinutes(day, rule.start_min),
            end_ms: atMinutes(day, rule.end_min),
            outcome: null,
            reason: null,
            follow_up_node_id: null,
            note: null,
            created_at: ts,
          }
          this.occurrences.set(row.id, row)
          existing.add(key)
          writes.push({
            kind: 'occurrence_created', node_id: row.node_id, target: 'occurrence',
            target_id: row.id, before: null, after: snap(row), ts,
          })
        }
        day = addDays(day, 1)
      }
    }

    if (writes.length) this.commit(...writes)
    return writes.length
  }

  pinProjection(nodeId: Id, dateMs: Millis): Occurrence {
    const day = localMidnight(dateMs)
    const already = [...this.occurrences.values()].find(
      (o) => o.node_id === nodeId && o.date_ms === day,
    )
    if (already) return already

    const rule = this.recurrences.get(nodeId)
    const ts = now()
    const row: Occurrence = {
      id: newId(ts),
      node_id: nodeId,
      date_ms: day,
      start_ms: atMinutes(day, rule?.start_min ?? null),
      end_ms: atMinutes(day, rule?.end_min ?? null),
      outcome: null,
      reason: null,
      follow_up_node_id: null,
      note: null,
      created_at: ts,
    }
    this.occurrences.set(row.id, row)
    this.commit({
      kind: 'occurrence_created', node_id: nodeId, target: 'occurrence',
      target_id: row.id, before: null, after: snap(row), ts,
    })
    return row
  }

  setOutcome(
    occurrenceId: Id,
    outcome: Outcome | null,
    extra?: { reason?: string | null; note?: string | null; follow_up_node_id?: Id | null },
  ): Occurrence {
    const before = this.occurrences.get(occurrenceId)
    if (!before) throw new Error(`setOutcome: no occurrence ${occurrenceId}`)
    const after: Occurrence = {
      ...before,
      outcome,
      reason: extra?.reason !== undefined ? extra.reason : before.reason,
      note: extra?.note !== undefined ? extra.note : before.note,
      follow_up_node_id:
        extra?.follow_up_node_id !== undefined ? extra.follow_up_node_id : before.follow_up_node_id,
    }
    this.occurrences.set(after.id, after)
    this.commit({
      kind: 'outcome_recorded', node_id: after.node_id, target: 'occurrence',
      target_id: after.id, before: snap(before), after: snap(after), ts: now(),
    })
    return after
  }

  moveOccurrence(occurrenceId: Id, startMs: Millis | null, endMs: Millis | null): Occurrence {
    const before = this.occurrences.get(occurrenceId)
    if (!before) throw new Error(`moveOccurrence: no occurrence ${occurrenceId}`)
    // `date_ms` follows the new start: a block moved past midnight belongs to the day it
    // now lands on, and local midnight is what that means (§5.7).
    const after: Occurrence = {
      ...before,
      start_ms: startMs,
      end_ms: endMs,
      date_ms: startMs === null ? before.date_ms : localMidnight(startMs),
    }
    this.occurrences.set(after.id, after)
    this.commit({
      kind: 'occurrence_moved', node_id: after.node_id, target: 'occurrence',
      target_id: after.id, before: snap(before), after: snap(after), ts: now(),
    })
    return after
  }

  // -------------------------------------------------------------------------
  // node types
  // -------------------------------------------------------------------------

  listNodeTypes(): NodeType[] {
    return [...this.nodeTypes.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  upsertNodeType(type: NodeType): NodeType {
    const before = this.nodeTypes.get(type.name)
    this.nodeTypes.set(type.name, type)
    this.commit({
      kind: 'node_type_defined', node_id: null, target: 'node_type',
      before: snap(before), after: snap(type), ts: now(),
    })
    return type
  }

  // -------------------------------------------------------------------------
  // revisions
  // -------------------------------------------------------------------------

  listRevisions(scope: string): Revision[] {
    return [...this.revisions.values()]
      .filter((r) => r.scope === scope)
      .sort((a, b) => a.ts - b.ts)
  }

  markRevision(scope: string, label?: string | null, manual = false): Revision {
    const ts = now()
    const rev: Revision = { id: newId(ts), scope, ts, label: label ?? null, manual }
    this.revisions.set(rev.id, rev)
    this.commit({
      kind: 'revision_marked', node_id: null, target: 'revision',
      target_id: rev.id, before: null, after: snap(rev), ts,
    })
    return rev
  }

  labelRevision(id: Id, label: string | null): Revision {
    const before = this.revisions.get(id)
    if (!before) throw new Error(`labelRevision: no revision ${id}`)
    const after: Revision = { ...before, label }
    this.revisions.set(id, after)
    this.commit({
      kind: 'revision_marked', node_id: null, target: 'revision',
      target_id: id, before: snap(before), after: snap(after), ts: now(),
    })
    return after
  }

  /** Consecutive revisions, paired. The last window is open-ended (§9). */
  revisionWindows(scope: string): RevisionWindow[] {
    const revs = this.listRevisions(scope)
    return revs.map((revision, i) => ({
      revision,
      start_ms: revision.ts,
      end_ms: i + 1 < revs.length ? revs[i + 1]!.ts : null,
    }))
  }

  stateAt(revisionId: Id) {
    const rev = this.revisions.get(revisionId)
    if (!rev) throw new Error(`stateAt: no revision ${revisionId}`)
    return this.replayTo(rev.ts)
  }

  // -------------------------------------------------------------------------
  // whole-database
  // -------------------------------------------------------------------------

  snapshot(): DatabaseSnapshot {
    return {
      nodes: this.listNodes(),
      spans: [...this.spans.values()],
      edges: [...this.edges.values()],
      events: this.allEvents(),
      recurrences: this.listRecurrences(),
      occurrences: this.listOccurrences(),
      revisions: [...this.revisions.values()].sort((a, b) => a.ts - b.ts),
      node_types: this.listNodeTypes(),
    }
  }

  /** No file behind this store. The JSON half of §5.8 still works; the .sqlite half does not. */
  exportBytes(): Uint8Array | null {
    return null
  }

  close(): void {
    this.listeners.clear()
  }

  /**
   * Load a snapshot without logging a second time. Used by the JSON import path and by
   * tests; the events in the snapshot ARE the history, so re-logging would double it.
   */
  static fromSnapshot(s: DatabaseSnapshot): MemoryStore {
    const store = new MemoryStore()
    store.hydrate(s)
    return store
  }
}

/**
 * Which event kind a node patch is. The DESIGN §2 vocabulary is specific on purpose —
 * `updated` would be useless to the apprentice model, which needs to learn that
 * retitling and abandoning are different acts.
 */
function kindForPatch(patch: NodePatch) {
  if (patch.status === 'abandoned') return 'abandoned' as const
  if (patch.status === 'done' || patch.status === 'completed') return 'completed' as const
  if (patch.status !== undefined) return 'status_changed' as const
  if (patch.title !== undefined) return 'retitled' as const
  if (patch.type !== undefined) return 'typed' as const
  if (patch.magnitude !== undefined) return 'magnitude_changed' as const
  if (patch.color !== undefined) return 'recolored' as const
  if (patch.body !== undefined) return 'note_added' as const
  return 'attrs_changed' as const
}

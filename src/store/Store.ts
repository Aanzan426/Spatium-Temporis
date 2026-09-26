/**
 * THE ARCHITECTURAL SEAM.
 *
 * Every read and write in the app goes through this interface. Nothing above it ever
 * imports sqlite, IndexedDB, Capacitor or Tauri directly. That discipline is the entire
 * reason web -> PWA -> Android APK -> desktop is a swap instead of a rewrite (§7).
 *
 * If you find yourself importing a storage library inside src/pages or src/timeline,
 * something has gone wrong.
 *
 * WHY THE METHODS ARE SYNCHRONOUS
 * -------------------------------
 * Both implementations are synchronous once open: a Map, and wasm SQLite, which does
 * not yield. Only *opening* is async (fetching the wasm binary, reading the file), so
 * that is where the promise lives — in the `open…` factory, not in six dozen call sites.
 * Making every read a promise would push `await` into render paths for no benefit and
 * make `useSyncExternalStore` impossible. If a network-backed store ever appears, it
 * gets its own async interface; it will not be a variant of this one.
 *
 * WHY EVERY WRITE APPENDS AN EVENT IN HERE AND NOT AT THE CALL SITE
 * -----------------------------------------------------------------
 * §5.3 is unenforceable if logging is the caller's job — the first forgotten call is
 * silent and permanent. Implementations log inside the mutator. A caller cannot write
 * without logging because there is no method that does one and not the other.
 */

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
} from '../core/types'
import type { WorldState } from './events'

/** A node with its span attached, which is what every projection actually wants. */
export interface Dated {
  node: Node
  span: Span
}

/** Everything, in one object. What `src/export/snapshot.ts` serializes (§5.8). */
export interface DatabaseSnapshot {
  nodes: Node[]
  spans: Span[]
  edges: Edge[]
  events: Event[]
  recurrences: Recurrence[]
  occurrences: Occurrence[]
  revisions: Revision[]
  node_types: NodeType[]
}

export interface Store {
  /** React subscribes here. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Bumped on every write. `useSyncExternalStore` compares it. */
  version(): number

  // nodes ------------------------------------------------------------------
  getNode(id: Id): Node | undefined
  listNodes(): Node[]
  createNode(input: NewNode, span?: SpanInput): Node
  updateNode(id: Id, patch: NodePatch): Node

  // spans ------------------------------------------------------------------
  getSpan(nodeId: Id): Span | undefined
  setSpan(nodeId: Id, span: SpanInput): Span
  /** Everything whose span overlaps [from, to). Undated nodes are never returned. */
  spansInRange(from: Millis, to: Millis): Dated[]
  /** The inbox: nodes with no span, or a span with no start (§10). Newest first. */
  undated(): Node[]

  // edges ------------------------------------------------------------------
  edgesForNode(id: Id): Edge[]
  link(from: Id, to: Id, relation: string): Edge
  unlink(edgeId: Id): void

  // events -----------------------------------------------------------------
  allEvents(): Event[]
  eventsInRange(from: Millis, to: Millis): Event[]
  eventsForNode(id: Id): Event[]
  /** Replay to a timestamp. The "as of" scrubber and the revision strip both use this. */
  replayTo(ts: Millis): WorldState

  // recurrence -------------------------------------------------------------
  getRecurrence(nodeId: Id): Recurrence | undefined
  setRecurrence(nodeId: Id, rule: RecurrenceInput): Recurrence
  clearRecurrence(nodeId: Id): void
  listRecurrences(): Recurrence[]

  // occurrences ------------------------------------------------------------
  /**
   * Materialized rows plus generated projections, merged (§5.5). A projection is
   * suppressed wherever a real row already exists for that `(node_id, date_ms)`.
   */
  blocksInRange(from: Millis, to: Millis): Block[]
  listOccurrences(): Occurrence[]
  /**
   * Freeze everything the rules imply up to `untilMs` into real rows. Idempotent.
   * Returns how many rows it wrote. Run on open and at each day boundary.
   */
  materializePast(untilMs: Millis): number
  /** Phase 2's UI writes through here; the columns and the method exist now (§9). */
  setOutcome(
    occurrenceId: Id,
    outcome: Outcome | null,
    extra?: { reason?: string | null; note?: string | null; follow_up_node_id?: Id | null },
  ): Occurrence
  /** Move one occurrence — the per-occurrence exception the rule cannot express. */
  moveOccurrence(occurrenceId: Id, startMs: Millis | null, endMs: Millis | null): Occurrence
  /** Materialize a single projected block so an exception can be recorded against it. */
  pinProjection(nodeId: Id, dateMs: Millis): Occurrence

  // node types -------------------------------------------------------------
  listNodeTypes(): NodeType[]
  upsertNodeType(type: NodeType): NodeType

  // revisions --------------------------------------------------------------
  listRevisions(scope: string): Revision[]
  /** A committed change. One per release of a drag, never one per frame (§9). */
  markRevision(scope: string, label?: string | null, manual?: boolean): Revision
  /** Label an existing revision, which names the window it opens. */
  labelRevision(id: Id, label: string | null): Revision
  /** Consecutive revisions paired into intervals. No table (§9). */
  revisionWindows(scope: string): RevisionWindow[]
  /** State as of a revision. Sugar over `replayTo(revision.ts)`. */
  stateAt(revisionId: Id): WorldState

  // whole-database ---------------------------------------------------------
  snapshot(): DatabaseSnapshot
  /** The `.sqlite` bytes, where the backend has them. Null for MemoryStore (§5.8). */
  exportBytes(): Uint8Array | null
  close(): void
}

/**
 * The domain model. No React, no DOM, no storage — pure types.
 *
 * Written from the schema in `docs/DESIGN.md` §2.
 *
 * Non-negotiables that show up as types here:
 *   - `type`, `span` and links are all NULLABLE. A title + timestamp is a valid node.
 *   - Precision: exact | hour | day | week | month | quarter | year | decade | someday
 *   - Magnitude: micro | kilo | mega | giga | tera   (this is the zoom filter, §4)
 *   - All timestamps are UTC epoch milliseconds. Always. No Date objects in the model.
 *
 * ON VOCABULARIES LIVING HERE
 * ---------------------------
 * `MAGNITUDES`, `PRECISIONS` and `OUTCOMES` used to be declared in
 * `src/export/workbook-layout.ts`. They are domain vocabulary, not workbook layout, and
 * `src/core` may never import from `src/export` — so they moved here and
 * `workbook-layout.ts` re-exports them. One definition, unchanged public surface
 * (CLAUDE.md invariant 10).
 */

/** UTC epoch milliseconds. Every instant in the system is one of these. */
export type Millis = number

/** A ULID. 26 chars, Crockford base32. Never an integer (§5.6). */
export type Id = string

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export const PRECISIONS = [
  'exact', 'hour', 'day', 'week', 'month', 'quarter', 'year', 'decade', 'someday',
] as const
export type Precision = (typeof PRECISIONS)[number]

export const MAGNITUDES = ['micro', 'kilo', 'mega', 'giga', 'tera'] as const
export type Magnitude = (typeof MAGNITUDES)[number]

export const OUTCOMES = ['done', 'skipped', 'partial', 'moved'] as const
export type Outcome = (typeof OUTCOMES)[number]

/**
 * How far either side of a nominal instant a precision reaches, in ms. Used only for
 * *rendering* the soft edges of an imprecise span (§3) — never for date arithmetic.
 * Approximate by construction: a "month" of fog does not need to know which month.
 */
export const PRECISION_FUZZ: Record<Precision, Millis> = {
  exact: 0,
  hour: 30 * 60_000,
  day: 12 * 3_600_000,
  week: 3.5 * 24 * 3_600_000,
  month: 15 * 24 * 3_600_000,
  quarter: 45 * 24 * 3_600_000,
  year: 182 * 24 * 3_600_000,
  decade: 1826 * 24 * 3_600_000,
  someday: 3652 * 24 * 3_600_000,
}

// ---------------------------------------------------------------------------
// The four concepts
// ---------------------------------------------------------------------------

/** A thing. `type` is nullable — capture is never gated on classification (§5.1). */
export interface Node {
  id: Id
  type: string | null
  title: string
  body: string | null
  status: string | null
  magnitude: Magnitude | null
  color: string | null
  /** User-defined section fields. A JSON column in SQLite. */
  attrs: Record<string, unknown>
  created_at: Millis
  updated_at: Millis
}

/** An extent. Both endpoints nullable: an undated thought is valid. */
export interface Span {
  id: Id
  node_id: Id
  start_ms: Millis | null
  start_precision: Precision
  end_ms: Millis | null
  end_precision: Precision
}

/** A link. `relation` is user-defined vocabulary. */
export interface Edge {
  id: Id
  from_node: Id
  to_node: Id
  relation: string
  created_at: Millis
}

export const EVENT_KINDS = [
  // the DESIGN §2 list
  'created', 'retitled', 'span_changed', 'linked', 'unlinked', 'status_changed',
  'note_added', 'split', 'abandoned', 'completed',
  // and the rest of the mutations, all of which must also be replayable
  'typed', 'magnitude_changed', 'recolored', 'attrs_changed',
  'recurrence_changed', 'occurrence_created', 'occurrence_moved', 'outcome_recorded',
  'node_type_defined', 'revision_marked',
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

/**
 * A change. Append-only (§5.3).
 *
 * `payload` carries `{before, after}` for every changed field (§5.4). A payload that
 * only names what changed is unreplayable and silently destroys both revision history
 * and the training corpus.
 */
export interface Event {
  id: Id
  ts: Millis
  node_id: Id | null
  kind: EventKind
  payload: EventPayload
  /**
   * Which device wrote this. See `src/core/device.ts` for why it is a column.
   * Nullable only because events written before it existed cannot be backfilled.
   */
  device_id: Id | null
  device_kind: string | null
}

/**
 * `before` is null on creation, `after` is null on removal (which only happens to
 * edges — nodes are never deleted, §5.2). `target` names the row the delta applies to
 * when it is not the node itself.
 */
export interface EventPayload {
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  target?: 'node' | 'span' | 'edge' | 'recurrence' | 'occurrence' | 'node_type' | 'revision'
  target_id?: Id
  /** Free-form context. Never load-bearing for replay. */
  note?: string
}

// ---------------------------------------------------------------------------
// Structural concepts (they get tables; domains never will — §2)
// ---------------------------------------------------------------------------

export type RecurrenceKind = 'daily' | 'weekly'

/** Field shapes kept RRULE-compatible. There is deliberately no parser (§9). */
export interface Recurrence {
  id: Id
  node_id: Id
  kind: RecurrenceKind
  /** 0 = Sunday … 6 = Saturday, local. Null for `daily`. */
  weekdays: number[] | null
  from_ms: Millis
  /** Null = open-ended. */
  until_ms: Millis | null
  /** Minutes past local midnight, or null for an all-day recurrence. */
  start_min: number | null
  end_min: number | null
}

/**
 * A block: one start–end slot with a category (DESIGN § Blocks and contents).
 *
 * `date_ms` is LOCAL MIDNIGHT of the day it belongs to, not the UTC instant of its
 * start time. Get this wrong and a 6am session lands on the wrong day twice a year
 * (§5.7).
 *
 * Past occurrences are materialized rows; future ones are generated and never stored
 * (§5.5).
 */
export interface Occurrence {
  id: Id
  node_id: Id
  date_ms: Millis
  start_ms: Millis | null
  end_ms: Millis | null
  /** null = pending. The adherence trio's UI is Phase 2; the columns exist now (§9). */
  outcome: Outcome | null
  reason: string | null
  follow_up_node_id: Id | null
  note: string | null
  created_at: Millis
  /**
   * When the outcome was ANSWERED, as opposed to when the block ended.
   *
   * §9's whole argument is that reconstruction is fiction: an outcome given two seconds
   * after a block ends and one reconstructed at midnight are different quality data.
   * Android will sometimes deliver an alarm late — Doze, a phone in a pocket, a
   * notification dismissed and answered hours later — so the gap is real and routine.
   *
   * Without this column the two are indistinguishable afterwards and every outcome has
   * to be treated as equally trustworthy, which is exactly the assumption the alarm
   * exists to avoid making. `answered_at - end_ms` is the honesty measure, and it
   * cannot be backfilled.
   */
  answered_at: Millis | null
}

/**
 * A generated, not-yet-materialized occurrence. Kept structurally distinct so nothing
 * can accidentally persist a projected future (§5.5).
 */
export interface ProjectedOccurrence {
  /** Deterministic synthetic key: `${node_id}:${date_ms}`. Never a ULID, never stored. */
  key: string
  node_id: Id
  date_ms: Millis
  start_ms: Millis | null
  end_ms: Millis | null
  projected: true
}

/** What the scheduler renders: a real row or a projection, uniformly. */
export type Block =
  | (Occurrence & { projected?: false })
  | ProjectedOccurrence

export const isProjected = (b: Block): b is ProjectedOccurrence => b.projected === true
export const blockKey = (b: Block): string => (isProjected(b) ? b.key : b.id)

export interface Revision {
  id: Id
  /** Which page/subtree this revision covers. `'scheduler'` for Phase 1. */
  scope: string
  ts: Millis
  /** Naming a revision names the revision window it opens (§9). */
  label: string | null
  manual: boolean
}

/** A revision window is the interval between two consecutive revisions. No table (§9). */
export interface RevisionWindow {
  revision: Revision
  start_ms: Millis
  /** Null for the newest, still-open window. */
  end_ms: Millis | null
}

export interface SectionField {
  key: string
  label: string
  kind: 'text' | 'number' | 'date' | 'enum'
  values?: string[]
}

/** User-defined at runtime. Adding "watches I want to buy" is a user action (§1). */
export interface NodeType {
  name: string
  color: string | null
  /** Soft structure: a `reading-session` *suggests* {book, pages}. Never enforced. */
  sections: SectionField[]
}

// ---------------------------------------------------------------------------
// Inputs — what callers hand the store, versus what the store hands back
// ---------------------------------------------------------------------------

/**
 * Creating a node requires a title and nothing else. This type is the enforcement of
 * §5.1: if any other field were mandatory here, the inbox would have to ask for it.
 */
export interface NewNode {
  title: string
  type?: string | null
  body?: string | null
  status?: string | null
  magnitude?: Magnitude | null
  color?: string | null
  attrs?: Record<string, unknown>
}

export type NodePatch = Partial<Omit<Node, 'id' | 'created_at' | 'updated_at'>>

export interface SpanInput {
  start_ms: Millis | null
  start_precision?: Precision
  end_ms: Millis | null
  end_precision?: Precision
}

export interface RecurrenceInput {
  kind: RecurrenceKind
  weekdays?: number[] | null
  from_ms: Millis
  until_ms?: Millis | null
  start_min?: number | null
  end_min?: number | null
}

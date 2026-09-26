/**
 * The workbook layout — defined ONCE, here, as data.
 *
 * Three separate pieces of code need to agree on what a window sheet looks like:
 *
 *   src/export/xlsx.ts               writes the real export from the database
 *   tools/xlsx-to-jsonl/sample.ts    writes the fixture workbook
 *   tools/xlsx-to-jsonl/normalize.ts reads a workbook back and validates it
 *
 * Hardcode the column list in each and they drift, silently, and the failure shows up as a
 * corrupted dataset months later. So none of them declare columns — they all import from
 * here, and the row types are *derived* from these arrays rather than written out.
 *
 * Add a column and `BlockRow` changes on its own; every reader and writer stops compiling
 * until it handles the new field. That is the point.
 *
 * WHY THIS ISN'T GENERATED FROM THE SQL SCHEMA
 * -------------------------------------------
 * A window sheet is not a table. It is a denormalized *view* that joins `occurrences`,
 * `nodes`, `spans`, `recurrences` and `edges` into one flat human-editable row. No single
 * CREATE TABLE contains these columns, so no amount of DDL parsing yields this layout.
 *
 * The database schema stays in `src/store/sqlite/migrations/001_init.sql`, where it is
 * clearest. To keep the two honest, assert they agree at runtime with
 * `PRAGMA table_info(...)` in a test — cheaper and far more robust than parsing DDL.
 */

/** What a value means, which is what tells the reader how to validate it (SPEC §3). */
export type ColumnKind =
  | 'ulid' // 26 chars, Crockford base32
  | 'date' // YYYY-MM-DD, local to _meta.tz
  | 'time' // HH:MM, local, may be blank
  | 'enum' // one of `values`
  | 'text'
  | 'int'

export type ColumnDef = {
  readonly key: string
  readonly width: number
  readonly kind: ColumnKind
  /** blank is a hard error when true */
  readonly required: boolean
  /**
   * False for the rejoin keys. A human editing one silently breaks the round trip, so the
   * reader treats a malformed value here as fatal rather than as a skip (SPEC §3.3).
   */
  readonly editable: boolean
  readonly values?: readonly string[]
  readonly note?: string
}

// ---------------------------------------------------------------------------
// Vocabularies — user-extensible at runtime, listed here only so the reader can
// warn on a typo. Never reject an unknown value: capture is never gated (DESIGN §5.1).
// ---------------------------------------------------------------------------

// Re-exported, not declared. These are DOMAIN vocabulary — they belong to the model in
// `src/core/types.ts`, and `src/core` may never import from `src/export`. Declaring them
// here as well would be exactly the drift invariant 10 exists to prevent: the workbook
// would keep validating against a list the app had already moved past.
//
// The public surface of this module is unchanged, so every consumer still imports them
// from here.
export { MAGNITUDES, OUTCOMES, PRECISIONS } from '../core/types'
import { MAGNITUDES, OUTCOMES, PRECISIONS } from '../core/types'

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

export const META_COLUMNS = [
  { key: 'schema_version', width: 16, kind: 'int', required: true, editable: false },
  { key: 'exported_at', width: 30, kind: 'text', required: true, editable: false },
  { key: 'source', width: 24, kind: 'text', required: true, editable: false },
  {
    key: 'tz',
    width: 20,
    kind: 'text',
    required: true,
    editable: false,
    note: 'IANA name. Every date in the workbook is local to this.',
  },
] as const satisfies readonly ColumnDef[]

export const WINDOW_COLUMNS = [
  { key: 'id', width: 28, kind: 'ulid', required: true, editable: false },
  { key: 'sheet', width: 8, kind: 'text', required: true, editable: false },
  { key: 'label', width: 18, kind: 'text', required: false, editable: true },
  { key: 'start', width: 14, kind: 'date', required: true, editable: false },
  { key: 'end', width: 14, kind: 'date', required: true, editable: false },
  { key: 'revision_id', width: 28, kind: 'ulid', required: true, editable: false },
] as const satisfies readonly ColumnDef[]

/**
 * One row per block — a start-end slot with a category
 * (DESIGN.md § Blocks and contents). The framework layer only: what was *planned*.
 *
 * What actually happened inside a block lives elsewhere. Contents are separate nodes joined
 * by edges, so one content node can sit in several contexts at once.
 */
export const BLOCK_COLUMNS = [
  { key: 'id', width: 28, kind: 'ulid', required: true, editable: false, note: 'rejoin key' },
  { key: 'node_id', width: 28, kind: 'ulid', required: true, editable: false, note: 'rejoin key' },
  { key: 'date', width: 12, kind: 'date', required: true, editable: false },
  { key: 'weekday', width: 9, kind: 'text', required: true, editable: false },
  { key: 'start', width: 7, kind: 'time', required: false, editable: true },
  { key: 'end', width: 7, kind: 'time', required: false, editable: true },
  { key: 'title', width: 22, kind: 'text', required: true, editable: true },
  { key: 'type', width: 12, kind: 'text', required: false, editable: true, note: 'the category' },
  { key: 'magnitude', width: 11, kind: 'enum', required: false, editable: true, values: MAGNITUDES },
  { key: 'precision', width: 11, kind: 'enum', required: false, editable: true, values: PRECISIONS },
  { key: 'recurrence', width: 26, kind: 'text', required: false, editable: true },
  { key: 'outcome', width: 10, kind: 'enum', required: false, editable: true, values: OUTCOMES },
  { key: 'reason', width: 26, kind: 'text', required: false, editable: true },
  { key: 'follow_up_node_id', width: 28, kind: 'ulid', required: false, editable: false },
  { key: 'note', width: 30, kind: 'text', required: false, editable: true },
  { key: 'parents', width: 26, kind: 'text', required: false, editable: false },
] as const satisfies readonly ColumnDef[]

// ---------------------------------------------------------------------------
// Derived types — never hand-written, so they cannot drift from the arrays above
// ---------------------------------------------------------------------------

type KeysOf<T extends readonly ColumnDef[]> = T[number]['key']
/** Every cell is read as a string; interpretation happens in normalize.ts (SPEC §3.1). */
type RowOf<T extends readonly ColumnDef[]> = { [K in KeysOf<T>]: string }

export type MetaRow = RowOf<typeof META_COLUMNS>
export type WindowRow = RowOf<typeof WINDOW_COLUMNS>
export type BlockRow = RowOf<typeof BLOCK_COLUMNS>

export type BlockKey = KeysOf<typeof BLOCK_COLUMNS>

// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1

/** Sheets beginning with `_` are metadata: carried through, never hand-curated. */
export const META_SHEET = '_meta'
export const WINDOWS_SHEET = '_windows'

/** Window sheets are `W01`, `W02`, … — see SPEC §3.11 on why labels can't be sheet names. */
export const windowSheetName = (index: number) => `W${String(index + 1).padStart(2, '0')}`

/**
 * The event log is deliberately NOT in this workbook.
 *
 * Events have a different lifecycle, different curation rules and a different shape — they
 * are not hand-edited at all, whereas window sheets exist to be. Mixing them into one file
 * means one export that is half-curated and half-raw, and a converter that has to branch on
 * which sheet it is looking at. They get their own export and their own converter path.
 */
export const EVENTS_ARE_A_SEPARATE_EXPORT = true

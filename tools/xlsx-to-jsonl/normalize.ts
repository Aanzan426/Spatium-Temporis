/**
 * normalize.ts — step 3 of SPEC §4. Raw cell values in; typed records and a list of
 * validation errors out.
 *
 * Every edge case in SPEC §3 lives here. The file is big because that list is long, and
 * that is the right place for it to be big: one function per quirk, all of them visible
 * next to each other, none of them hiding in the reader or the emitter.
 *
 * IT RETURNS ERRORS RATHER THAN THROWING
 * --------------------------------------
 * A curation pass over a month of schedule produces several mistakes at once. Throwing
 * on the first one means fixing them one run at a time, which is the difference between
 * a ten-second loop and an afternoon. So: collect everything, report it all, and let
 * the CLI decide what is fatal.
 *
 * WHAT IS FATAL, AND THE ONE RULE BEHIND IT
 * -----------------------------------------
 * Anything that breaks the *rejoin* is fatal (a bad id, a duplicate id, an unknown
 * schema version). Anything else is a warning, because the workbook exists to be edited
 * by a human and a typo'd type name is a curation decision, not corruption. Capture is
 * never gated on classification (DESIGN §5.1) — so neither is curation.
 */

import { MAGNITUDES, OUTCOMES, PRECISIONS } from '../../src/core/types'
import {
  BLOCK_COLUMNS,
  META_SHEET,
  SCHEMA_VERSION,
  WINDOWS_SHEET,
} from '../../src/export/workbook-layout'
import type { BlockRow } from '../../src/export/workbook-layout'
import type { RawSheet, RawWorkbook } from './read'
import { zonedToUtcMs } from './tz'

export interface Meta {
  schemaVersion: number
  exportedAt: string
  source: string
  tz: string
}

export interface RevisionWindow {
  id: string
  sheet: string
  label: string | null
  start: string
  end: string
  revisionId: string
}

/** A block row, plus what the grid could not carry: which window it came from. */
export interface NormalizedBlock extends BlockRow {
  windowId: string
  sheet: string
  rowNumber: number
  /**
   * Local dates resolved against `_meta.tz`. Kept ALONGSIDE the strings rather than
   * replacing them: the strings are what a human curated and what the diff should show;
   * these are what a program joins on.
   */
  date_ms: number
  start_ms: number | null
  end_ms: number | null
}

export interface Normalized {
  meta: Meta
  windows: RevisionWindow[]
  rows: NormalizedBlock[]
}

export interface Problem {
  severity: 'error' | 'warning'
  sheet: string
  row?: number
  message: string
}

export interface NormalizeResult {
  data: Normalized | null
  problems: Problem[]
  counts: { sheets: number; rows: number; skipped: number }
}

/** §3.3 — 26 chars, Crockford base32: no I, L, O or U. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

export function normalize(raw: RawWorkbook): NormalizeResult {
  const problems: Problem[] = []
  const err = (sheet: string, message: string, row?: number) =>
    problems.push({ severity: 'error', sheet, row, message })
  const warn = (sheet: string, message: string, row?: number) =>
    problems.push({ severity: 'warning', sheet, row, message })

  // Cell-level complaints from the reader are warnings by default, except the ones that
  // mean the export itself is broken (§3.1) — those are errors, because every date in
  // the workbook is then suspect.
  for (const p of raw.problems) {
    const fatal = /numeric cell|date cell|merged cells/.test(p.message)
    problems.push({
      severity: fatal ? 'error' : 'warning',
      sheet: p.sheet,
      row: p.row,
      message: p.column ? `${p.column}${p.row ?? ''}: ${p.message}` : p.message,
    })
  }

  const byName = new Map(raw.sheets.map((s) => [s.name, s]))

  // --- _meta ---------------------------------------------------------------
  const metaSheet = byName.get(META_SHEET)
  if (!metaSheet || metaSheet.rows.length === 0) {
    err(META_SHEET, 'missing — the workbook cannot be read without its timezone')
    return { data: null, problems, counts: { sheets: 0, rows: 0, skipped: 0 } }
  }
  const metaCells = metaSheet.rows[0]!.cells
  const meta: Meta = {
    schemaVersion: Number(metaCells.schema_version),
    exportedAt: metaCells.exported_at ?? '',
    source: metaCells.source ?? '',
    tz: metaCells.tz ?? '',
  }

  /**
   * §1 — "the reader must reject unknown versions rather than guess". A workbook from a
   * future layout may have columns that mean something different under the same name,
   * and guessing there produces a dataset that is wrong in a way nothing downstream can
   * detect.
   */
  if (!Number.isInteger(meta.schemaVersion)) {
    err(META_SHEET, `schema_version is not a number: ${String(metaCells.schema_version)}`)
  } else if (meta.schemaVersion !== SCHEMA_VERSION) {
    err(
      META_SHEET,
      `schema_version ${meta.schemaVersion}, this converter reads ${SCHEMA_VERSION}`,
    )
  }
  if (!meta.tz) err(META_SHEET, 'tz is blank — every date in the workbook is local to it')

  // --- _windows ------------------------------------------------------------
  const windowsSheet = byName.get(WINDOWS_SHEET)
  const windows: RevisionWindow[] = []
  if (!windowsSheet) {
    err(WINDOWS_SHEET, 'missing')
  } else {
    for (const { rowNumber, cells } of windowsSheet.rows) {
      if (!cells.id) continue
      if (!ULID.test(cells.id)) {
        err(WINDOWS_SHEET, `malformed window id: ${cells.id}`, rowNumber)
        continue
      }
      windows.push({
        id: cells.id,
        sheet: cells.sheet ?? '',
        label: cells.label ? cells.label : null,
        start: cells.start ?? '',
        end: cells.end ?? '',
        revisionId: cells.revision_id ?? '',
      })
    }
  }

  // --- window sheets -------------------------------------------------------
  const rows: NormalizedBlock[] = []
  const seenIds = new Map<string, { sheet: string; row: number }>()
  let skipped = 0

  for (const window of windows) {
    const sheet = byName.get(window.sheet)
    if (!sheet) {
      err(WINDOWS_SHEET, `window ${window.id} points at missing sheet ${window.sheet}`)
      continue
    }
    checkHeader(sheet, err)

    for (const { rowNumber, cells } of sheet.rows) {
      /**
       * §3.5 / §3.6 — a row without an id is either a blank row or a row a human
       * deleted the id from. Both mean "skip", and neither is an error: deleting a row
       * is a person saying "don't train on this", which is the entire point of
       * curation. The COUNT is reported, because silent loss looks exactly like a
       * parser bug that ate rows.
       */
      if (!cells.id) {
        skipped++
        continue
      }

      // §3.3 — a retyped or autofilled id destroys the rejoin silently, so a malformed
      // one is a hard error naming the sheet and row, never a skip.
      if (!ULID.test(cells.id)) {
        err(sheet.name, `malformed id "${cells.id}" — 26 chars, Crockford base32`, rowNumber)
        continue
      }

      // §3.4 — copy-pasting a row is one keystroke and produces two identical ids.
      const prior = seenIds.get(cells.id)
      if (prior) {
        err(
          sheet.name,
          `duplicate id ${cells.id} — also at ${prior.sheet} row ${prior.row}`,
          rowNumber,
        )
        continue
      }
      seenIds.set(cells.id, { sheet: sheet.name, row: rowNumber })

      if (cells.node_id && !ULID.test(cells.node_id)) {
        err(sheet.name, `malformed node_id "${cells.node_id}"`, rowNumber)
        continue
      }

      // --- formats -------------------------------------------------------
      if (!DATE.test(cells.date ?? '')) {
        err(sheet.name, `date must be YYYY-MM-DD, got "${cells.date ?? ''}"`, rowNumber)
        continue
      }
      for (const key of ['start', 'end'] as const) {
        const v = cells[key] ?? ''
        if (v !== '' && !TIME.test(v)) {
          warn(sheet.name, `${key} should be HH:MM, got "${v}"`, rowNumber)
        }
      }

      // --- vocabularies: warn, never reject ------------------------------
      // A user-extensible vocabulary means an unknown value is usually a new category,
      // not a mistake. Warn so a typo is visible; reject nothing (DESIGN §5.1).
      checkVocab(cells.magnitude, MAGNITUDES, 'magnitude', sheet.name, rowNumber, warn)
      checkVocab(cells.precision, PRECISIONS, 'precision', sheet.name, rowNumber, warn)
      checkVocab(cells.outcome, OUTCOMES, 'outcome', sheet.name, rowNumber, warn)

      /**
       * §3.2 — `new Date('2026-08-01')` is midnight UTC, which is the previous day in
       * any negative-offset zone. Everything here goes through `_meta.tz`, and
       * `date_ms` comes out as local midnight, matching `occurrences.date_ms`
       * (DESIGN §5.7) so the rejoin lines up on the nose.
       */
      const date_ms = zonedToUtcMs(cells.date!, '00:00', meta.tz)
      const start_ms = cells.start ? zonedToUtcMs(cells.date!, cells.start, meta.tz) : null
      const end_ms = cells.end ? zonedToUtcMs(cells.date!, cells.end, meta.tz) : null

      // Built column by column from BLOCK_COLUMNS rather than by spreading `cells`:
      // that way an unexpected extra column in the sheet cannot leak into the record,
      // and a missing one becomes '' rather than `undefined` (SPEC §2).
      const fields: Record<string, string> = {}
      for (const col of BLOCK_COLUMNS) fields[col.key] = cells[col.key] ?? ''
      const row = fields as unknown as NormalizedBlock
      row.windowId = window.id
      row.sheet = sheet.name
      row.rowNumber = rowNumber
      row.date_ms = date_ms
      row.start_ms = start_ms
      row.end_ms = end_ms
      rows.push(row)
    }
  }

  // §3.12 — deterministic order: same workbook in, byte-identical JSONL out.
  rows.sort(
    (a, b) =>
      a.windowId.localeCompare(b.windowId) ||
      a.date.localeCompare(b.date) ||
      a.start.localeCompare(b.start) ||
      a.id.localeCompare(b.id),
  )

  return {
    data: { meta, windows, rows },
    problems,
    counts: { sheets: windows.length, rows: rows.length, skipped },
  }
}

/**
 * The header must match `BLOCK_COLUMNS` exactly. Not cosmetic: a missing column reads
 * as every row having a blank there, and a reordered one is invisible because rows are
 * read by header name — until someone hand-edits the header itself, which is exactly
 * the kind of thing that happens to a file that exists to be hand-edited.
 */
function checkHeader(sheet: RawSheet, err: (s: string, m: string, r?: number) => void): void {
  const expected = BLOCK_COLUMNS.map((c) => c.key)
  const actual = sheet.header.filter((h) => h !== undefined && h !== '')
  const missing = expected.filter((k) => !actual.includes(k))
  const extra = actual.filter((k) => !(expected as readonly string[]).includes(k))
  if (missing.length) err(sheet.name, `header missing columns: ${missing.join(', ')}`, 1)
  if (extra.length) err(sheet.name, `header has unknown columns: ${extra.join(', ')}`, 1)
}

function checkVocab(
  value: string | undefined,
  allowed: readonly string[],
  field: string,
  sheet: string,
  row: number,
  warn: (s: string, m: string, r?: number) => void,
): void {
  if (!value) return
  if (!allowed.includes(value)) {
    warn(sheet, `unknown ${field} "${value}" — known: ${allowed.join(', ')}`, row)
  }
}

export const hasErrors = (problems: readonly Problem[]): boolean =>
  problems.some((p) => p.severity === 'error')

export function formatProblem(p: Problem): string {
  const where = p.row ? `${p.sheet}!${p.row}` : p.sheet
  return `${p.severity === 'error' ? 'ERROR' : 'warn '}  ${where.padEnd(12)} ${p.message}`
}

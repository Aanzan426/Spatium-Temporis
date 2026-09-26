/**
 * XLSX export — the human curation surface (§11).
 *
 * GENERATED ON DEMAND. Never a file kept in sync on every write: that is a second
 * source of truth that will drift, and it puts sync obligations on every write path.
 * The database already has everything.
 *
 * The decisive reason: the right export format is unknowable until fine-tuning is
 * actually attempted, and it will be rewritten five or six times. Generated on demand,
 * a format change costs one function and every past month can be re-emitted in the new
 * shape. Maintained incrementally, the earliest months — the ones that can never be
 * recreated — are stuck worst.
 *
 * One sheet per revision window (a window = the interval between two revisions).
 *
 * EVERY ROW CARRIES ITS `id`. That is what lets tools/xlsx-to-jsonl rejoin to the
 * database and recover the nested structure that flattening to a grid destroyed.
 * Without it the round trip is lossy in exactly one direction, which is the worst kind.
 *
 * THE LAYOUT IS NOT DECLARED HERE. It is imported from `workbook-layout.ts`, which
 * `tools/xlsx-to-jsonl/sample.ts` and `normalize.ts` also import. Three consumers, one
 * definition — add a column there and this file stops compiling until it supplies it,
 * which is the entire mechanism (CLAUDE.md invariant 10).
 *
 * EVERY CELL IS WRITTEN AS TEXT (SPEC §3.1). Excel's serial dates and the 1900
 * leap-year bug are avoided by never writing a date cell at all; the reader then gets a
 * string from every column, every time, instead of a `Date | string | number` lottery.
 */

import { describeRecurrence } from '../core/recurrence'
import { fmtDate, fmtIso, fmtTime, fmtWeekdayShort } from '../core/time'
import type { Millis, Occurrence } from '../core/types'
import { isProjected } from '../core/types'
import type { Store } from '../store/Store'
import type { BlockRow, ColumnDef, MetaRow, WindowRow } from './workbook-layout'
import {
  BLOCK_COLUMNS,
  META_COLUMNS,
  META_SHEET,
  SCHEMA_VERSION,
  WINDOWS_SHEET,
  WINDOW_COLUMNS,
  windowSheetName,
} from './workbook-layout'
import { utf8, xmlEscape, zip } from './zip'

export interface Sheet {
  name: string
  columns: readonly ColumnDef[]
  rows: readonly Record<string, string>[]
}

export interface WorkbookData {
  meta: MetaRow
  windows: WindowRow[]
  sheets: Sheet[]
}

export interface BuildOptions {
  scope?: string
  source?: string
  /**
   * IANA name. Every date in the workbook is local to this (SPEC §1).
   *
   * It must be the zone this process is running in, because the dates are rendered with
   * the machine's local calendar — this option NAMES that zone for the reader, it does
   * not convert into it. Passing a different one produces dates in one zone labelled as
   * another, and the reader then rejoins every row to the wrong instant.
   */
  tz?: string
  exportedAt?: Millis
}

/**
 * Build the workbook's *content* from the store. Pure, no zip, no XML — which is what
 * makes it testable against the fixture without writing a file.
 */
export function buildWorkbook(store: Store, options: BuildOptions = {}): WorkbookData {
  const scope = options.scope ?? 'scheduler'
  const exportedAt = options.exportedAt ?? Date.now()
  const tz = options.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  const meta: MetaRow = {
    schema_version: String(SCHEMA_VERSION),
    exported_at: fmtIso(exportedAt),
    source: options.source ?? 'spatium-temporis',
    tz,
  }

  const nodes = new Map(store.listNodes().map((n) => [n.id, n]))
  const windows = store.revisionWindows(scope)
  const windowRows: WindowRow[] = []
  const sheets: Sheet[] = []

  /**
   * The first window reaches BACK past its own revision.
   *
   * A revision window is the interval between two consecutive revisions (§9), which
   * leaves everything before the first revision owned by no window at all — and those
   * are the oldest blocks, the ones that can never be recreated. Clamping window 0 to
   * the earliest occurrence costs one line and stops the export silently beginning at
   * whenever someone first pressed "mark revision".
   */
  const earliest = store
    .listOccurrences()
    .reduce<number | null>((min, o) => (min === null || o.date_ms < min ? o.date_ms : min), null)

  windows.forEach((w, index) => {
    const sheetName = windowSheetName(index)
    const start = index === 0 && earliest !== null ? Math.min(w.start_ms, earliest) : w.start_ms
    const end = w.end_ms ?? exportedAt

    windowRows.push({
      id: w.revision.id,
      sheet: sheetName,
      label: w.revision.label ?? '',
      start: fmtDate(start),
      end: fmtDate(end),
      revision_id: w.revision.id,
    })

    /**
     * Only materialized rows are exported. A projection has no `id`, and an id is what
     * the whole round trip rests on (SPEC §3.3) — exporting a future block would put a
     * row in the curation surface that can never be rejoined, and a human editing it
     * would be editing something that does not exist.
     */
    const blocks = store
      .blocksInRange(start, end)
      .filter((b): b is Occurrence => !isProjected(b))

    const rows: BlockRow[] = blocks.map((b) => {
      const node = nodes.get(b.node_id)
      const span = store.getSpan(b.node_id)
      const parents = store
        .edgesForNode(b.node_id)
        .filter((e) => e.to_node === b.node_id)
        .map((e) => nodes.get(e.from_node)?.title ?? e.from_node)
        .join('; ')

      return {
        id: b.id,
        node_id: b.node_id,
        date: fmtDate(b.date_ms),
        weekday: fmtWeekdayShort(b.date_ms),
        start: b.start_ms === null ? '' : fmtTime(b.start_ms),
        end: b.end_ms === null ? '' : fmtTime(b.end_ms),
        title: node?.title ?? '',
        type: node?.type ?? '',
        magnitude: node?.magnitude ?? '',
        precision: span?.start_precision ?? '',
        recurrence: describeRecurrence(store.getRecurrence(b.node_id)),
        // Blank through Phase 1 — enactment is Phase 2 (§9). The columns exist so that
        // no migration and no layout change is needed when it arrives.
        outcome: b.outcome ?? '',
        reason: b.reason ?? '',
        follow_up_node_id: b.follow_up_node_id ?? '',
        note: b.note ?? '',
        parents,
      }
    })

    // SPEC §3.12 — stable sort, so two exports of unchanged data differ in nothing but
    // `exported_at`.
    rows.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id),
    )

    sheets.push({ name: sheetName, columns: BLOCK_COLUMNS, rows })
  })

  return { meta, windows: windowRows, sheets }
}

// ---------------------------------------------------------------------------
// XLSX serialization
// ---------------------------------------------------------------------------

/** Column index → spreadsheet letters. 0 → A, 25 → Z, 26 → AA. */
export function colLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function sheetXml(columns: readonly ColumnDef[], rows: readonly Record<string, string>[]): string {
  const cell = (r: number, c: number, text: string) =>
    // `t="inlineStr"` keeps the string in the cell instead of a shared-strings table:
    // one less part to write, and no chance of an index mismatch. `s="1"` is the text
    // format defined in STYLES below — belt and braces for §3.1.
    `<c r="${colLetter(c)}${r}" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlEscape(
      text,
    )}</t></is></c>`

  const header = `<row r="1">${columns
    .map((col, c) => cell(1, c, col.key))
    .join('')}</row>`

  const body = rows
    .map(
      (row, i) =>
        `<row r="${i + 2}">${columns
          .map((col, c) => cell(i + 2, c, row[col.key] ?? ''))
          .join('')}</row>`,
    )
    .join('')

  const lastCol = colLetter(Math.max(columns.length - 1, 0))
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${columns
    .map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${col.width}" customWidth="1"/>`)
    .join('')}</cols>
<sheetData>${header}${body}</sheetData>
<autoFilter ref="A1:${lastCol}${rows.length + 1}"/>
</worksheet>`
}

/** numFmtId 49 is the built-in `@` text format. Everything is written with it (§3.1). */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="0"/>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
</styleSheet>`

/** The workbook, as `.xlsx` bytes. No spreadsheet library involved — see `zip.ts`. */
export function toXlsx(data: WorkbookData): Uint8Array {
  const sheets: Sheet[] = [
    { name: META_SHEET, columns: META_COLUMNS, rows: [data.meta] },
    { name: WINDOWS_SHEET, columns: WINDOW_COLUMNS, rows: data.windows },
    ...data.sheets,
  ]

  const files = [
    {
      name: '[Content_Types].xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
</Types>`),
    },
    {
      name: '_rels/.rels',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      name: 'xl/workbook.xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets
        .map(
          (s, i) =>
            `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join('')}</sheets>
</workbook>`),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    },
    { name: 'xl/styles.xml', data: utf8(STYLES) },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: utf8(sheetXml(s.columns, s.rows)),
    })),
  ]

  return zip(files)
}

/** Browser convenience. ⌘E in `App.tsx`. */
export function downloadWorkbook(store: Store, options: BuildOptions = {}): void {
  const bytes = toXlsx(buildWorkbook(store, options))
  const stamp = fmtDate(options.exportedAt ?? Date.now())
  download(bytes, `spatium-${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}

export function download(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // Revoking immediately can cancel the download in some browsers; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

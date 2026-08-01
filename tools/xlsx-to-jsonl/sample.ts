/**
 * sample.ts — generates the fixture workbook everything else is tested against.
 *
 * WHAT THIS IS: a test double. It stands in for a database that does not exist yet, so
 * `read.ts` and `normalize.ts` have something to chew on. Nothing in the app calls it, and
 * it gets deleted the day `src/export/xlsx.ts` can produce a real workbook.
 *
 * The *data* below is hardcoded on purpose — it is fake. The *layout* is not: columns come
 * from `src/export/workbook-layout.ts`, which the real exporter and the reader also import.
 * One definition, three consumers, no drift.
 *
 *   npx tsx tools/xlsx-to-jsonl/sample.ts
 *   npx tsx tools/xlsx-to-jsonl/sample.ts path/to/other.xlsx
 *
 * Three rules it follows, each earning its keep:
 *
 *   §3.1  Every cell is written as TEXT, explicitly formatted `@`. Write dates as date cells
 *         and exceljs hands the reader back a Date, a string or a number depending on
 *         formatting — the same column, three types.
 *
 *   §3.2  No `Date` is ever constructed from a calendar date. `new Date('2026-08-03')` parses
 *         as midnight UTC, which in a negative-offset zone is the previous day. Dates here
 *         are literal strings with their weekday stated, so there is nothing to get wrong.
 *
 *   §3.12 Content is deterministic — fixed ids, fixed timestamps, fixed workbook metadata.
 *         Run it twice and every XML entry inside the file is byte-identical.
 *
 *         The FILE is not byte-identical, and that is not fixable here: an .xlsx is a zip,
 *         and exceljs calls `zip.append(data, {name})` without a `date`, so archiver stamps
 *         each entry with wall-clock time. Measured — entry contents match exactly, only the
 *         zip `date_time` moves. Don't lose an afternoon to the md5 not matching.
 *
 *         It doesn't matter: §3.12 is a requirement on the JSONL output, which is plain text
 *         and genuinely byte-deterministic. The workbook is a regenerable fixture.
 *
 * NO EVENT SHEET. Events have a different lifecycle and different curation rules — they are
 * never hand-edited, window sheets exist to be. They get their own export and their own
 * converter path.
 */

import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import ExcelJS from 'exceljs'
import type { Workbook as ExcelWorkbook, Worksheet } from 'exceljs'
import {
  BLOCK_COLUMNS,
  META_COLUMNS,
  META_SHEET,
  SCHEMA_VERSION,
  WINDOWS_SHEET,
  WINDOW_COLUMNS,
  windowSheetName,
} from '../../src/export/workbook-layout'
import type { BlockRow, ColumnDef, MetaRow, WindowRow } from '../../src/export/workbook-layout'

/**
 * Why a default import and not `import { Workbook } from 'exceljs'`.
 *
 * exceljs is CommonJS. Its bundled `.d.ts` declares ES-style named exports, so TypeScript
 * accepts `import { Workbook }` and `tsc` passes — but at runtime Node's ESM loader has to
 * *guess* a CJS module's named exports by scanning its source, and with exceljs it comes up
 * empty. Result: a clean typecheck and `SyntaxError: does not provide an export named
 * 'Workbook'` the moment you run it.
 *
 * Measured: the namespace's `.Workbook` is `undefined`, while `.default` is the whole
 * `module.exports` and `.default.Workbook` is the constructor.
 *
 * Rule of thumb: a passing typecheck does not mean a CommonJS import works. Run it.
 */
const { Workbook } = ExcelJS
// `Workbook` above is a *value* from the destructure; the type of the same name has to be
// imported separately, hence `ExcelWorkbook` in the signatures below.

// ---------------------------------------------------------------------------
// Fixture configuration
// ---------------------------------------------------------------------------

/** Every date in the workbook is local to this. */
const TZ = 'Asia/Kolkata'

/** Fixed, not `new Date()` — see §3.12. */
const EXPORTED_AT = '2026-08-01T10:00:00+05:30'

const SOURCE = 'sample.ts (fixture)'
const DEFAULT_OUT = 'tools/xlsx-to-jsonl/fixtures/sample.xlsx'

// ---------------------------------------------------------------------------
// Deterministic fake ULIDs
// ---------------------------------------------------------------------------

/** Crockford base32: no I, L, O or U, so nothing can be misread as 1 or 0. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function base32(value: number, length: number): string {
  let out = ''
  let n = Math.floor(Math.abs(value))
  for (let i = 0; i < length; i++) {
    out = CROCKFORD[n % 32] + out
    n = Math.floor(n / 32)
  }
  return out
}

/** The real generator is random; this one is seeded, because fixtures must not move. */
const BASE_TS = 1_785_000_000_000
const ulid = (seed: number) => base32(BASE_TS + seed * 60_000, 10) + base32(seed, 16)

/**
 * Stable node id per activity title. Two windows scheduling "Quant reading" are scheduling
 * the same node, so they must resolve to the same id — keying this on position within a
 * template silently forks one node into two.
 */
const nodeSeeds = new Map<string, number>()
function nodeIdFor(title: string): string {
  let seed = nodeSeeds.get(title)
  if (seed === undefined) {
    seed = 200 + nodeSeeds.size
    nodeSeeds.set(title, seed)
  }
  return ulid(seed)
}

// ---------------------------------------------------------------------------
// The fake schedule
// ---------------------------------------------------------------------------

/**
 * A block: one start-end slot with a category. `type` is the category — sleep / work /
 * hobbies / college / travel — an ordinary user-defined node type, never anything the code
 * knows about.
 */
type BlockTemplate = {
  start: string
  end: string
  title: string
  type: string
  magnitude: string
  recurrence: string
}

const BASELINE: BlockTemplate[] = [
  { start: '00:30', end: '07:00', title: 'Sleep', type: 'sleep', magnitude: 'micro', recurrence: 'daily' },
  { start: '07:00', end: '08:00', title: 'Gym — push', type: 'hobbies', magnitude: 'kilo', recurrence: 'weekly Mon,Wed,Fri' },
  { start: '09:00', end: '10:00', title: 'Commute', type: 'travel', magnitude: 'micro', recurrence: 'weekly Mon,Tue,Wed,Thu,Fri' },
  { start: '10:00', end: '17:00', title: 'Internship', type: 'work', magnitude: 'mega', recurrence: 'weekly Mon,Tue,Wed,Thu,Fri' },
  { start: '19:00', end: '20:30', title: 'Quant reading', type: 'hobbies', magnitude: 'mega', recurrence: 'daily' },
]

const EXAM_PREP: BlockTemplate[] = [
  { start: '01:00', end: '07:30', title: 'Sleep', type: 'sleep', magnitude: 'micro', recurrence: 'daily' },
  { start: '08:00', end: '12:00', title: 'Revision block', type: 'college', magnitude: 'mega', recurrence: 'daily' },
  { start: '13:00', end: '17:00', title: 'Past papers', type: 'college', magnitude: 'mega', recurrence: 'daily' },
  { start: '19:00', end: '20:00', title: 'Quant reading', type: 'hobbies', magnitude: 'kilo', recurrence: 'daily' },
]

/** Literal dates with their weekday stated — nothing is derived, so §3.2 cannot bite. */
type Day = { date: string; weekday: string }

type FixtureWindow = {
  id: string
  label: string
  revisionId: string
  days: Day[]
  template: BlockTemplate[]
}

const WINDOWS: FixtureWindow[] = [
  {
    id: ulid(1),
    label: 'baseline',
    revisionId: ulid(101),
    template: BASELINE,
    days: [
      { date: '2026-08-03', weekday: 'Mon' },
      { date: '2026-08-04', weekday: 'Tue' },
      { date: '2026-08-05', weekday: 'Wed' },
    ],
  },
  {
    id: ulid(2),
    label: 'exam prep',
    revisionId: ulid(102),
    template: EXAM_PREP,
    days: [
      { date: '2026-08-10', weekday: 'Mon' },
      { date: '2026-08-11', weekday: 'Tue' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Sheet helpers — headers and widths come from the layout, never from here
// ---------------------------------------------------------------------------

/**
 * Force every cell to text format (`@`).
 *
 * The single most important line in this file. Without it Excel reinterprets `2026-08-03` as
 * a date, `00:30` as a time, and a title like `3-4` as March 4th — and the reader inherits
 * every one of those.
 */
function forceTextFormat(sheet: Worksheet) {
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.numFmt = '@'
    })
  })
}

function addSheet(
  wb: ExcelWorkbook,
  name: string,
  columns: readonly ColumnDef[],
  rows: readonly object[],
): Worksheet {
  const sheet = wb.addWorksheet(name)
  sheet.columns = columns.map((c) => ({ header: c.key, key: c.key, width: c.width }))
  for (const row of rows) sheet.addRow(row)

  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  forceTextFormat(sheet)
  return sheet
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function buildMeta(wb: ExcelWorkbook) {
  const row: MetaRow = {
    schema_version: String(SCHEMA_VERSION),
    exported_at: EXPORTED_AT,
    source: SOURCE,
    tz: TZ,
  }
  addSheet(wb, META_SHEET, META_COLUMNS, [row])
}

function buildWindows(wb: ExcelWorkbook) {
  const rows: WindowRow[] = WINDOWS.map((w, i) => ({
    id: w.id,
    sheet: windowSheetName(i),
    label: w.label,
    start: w.days[0].date,
    end: w.days[w.days.length - 1].date,
    revision_id: w.revisionId,
  }))
  addSheet(wb, WINDOWS_SHEET, WINDOW_COLUMNS, rows)
}

function buildWindowSheet(wb: ExcelWorkbook, window: FixtureWindow, index: number, seedBase: number) {
  const rows: BlockRow[] = []
  let seed = seedBase

  for (const day of window.days) {
    for (const block of window.template) {
      rows.push({
        id: ulid(seed++),
        node_id: nodeIdFor(block.title),
        date: day.date,
        weekday: day.weekday,
        start: block.start,
        end: block.end,
        title: block.title,
        type: block.type,
        magnitude: block.magnitude,
        precision: 'exact',
        recurrence: block.recurrence,
        // Adherence is Phase 2. These columns exist now so no migration is ever needed
        // (DESIGN.md §9) — deliberately blank.
        outcome: '',
        reason: '',
        follow_up_node_id: '',
        note: '',
        parents: '',
      })
    }
  }

  // §3.12 — stable sort, so nothing moves between runs.
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id),
  )

  addSheet(wb, windowSheetName(index), BLOCK_COLUMNS, rows)
}

async function main() {
  const out = resolve(process.argv[2] ?? DEFAULT_OUT)

  const wb = new Workbook()
  // Fixed metadata, or the workbook's own docProps change on every run (§3.12).
  wb.created = new Date(EXPORTED_AT)
  wb.modified = new Date(EXPORTED_AT)
  wb.creator = SOURCE
  wb.lastModifiedBy = SOURCE

  buildMeta(wb)
  buildWindows(wb)
  WINDOWS.forEach((w, i) => buildWindowSheet(wb, w, i, 1000 + i * 1000))

  await mkdir(dirname(out), { recursive: true })
  await wb.xlsx.writeFile(out)

  const blocks = WINDOWS.reduce((n, w) => n + w.days.length * w.template.length, 0)
  console.log(`wrote ${out}`)
  console.log(`  ${WINDOWS.length} windows, ${blocks} blocks, ${BLOCK_COLUMNS.length} columns, tz ${TZ}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

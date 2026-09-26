/**
 * broken.ts — the second fixture (SPEC §4, "Two fixtures, not one").
 *
 * `sample.ts` produces VALID data, which means every error path in SPEC §3 goes
 * untested, because valid input never triggers one. A validator that has never been
 * shown a broken file is a validator nobody has any reason to believe in.
 *
 * So this writes a workbook that is wrong in six specific, deliberate ways, one per
 * row, and `roundtrip.ts` asserts that each one actually fires. If a check is ever
 * silently broken — a regex loosened, a branch reordered — this is what notices.
 *
 * It is written with exceljs rather than with the app's own writer on purpose: the
 * faults below (a real date cell, a formula cell, a merge) are ones the app's writer
 * cannot produce, because it always writes text. Producing them needs a library that
 * will do the wrong thing on request.
 *
 *   npx tsx tools/xlsx-to-jsonl/broken.ts [out.xlsx]
 */

import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import ExcelJS from 'exceljs'
import type { Worksheet } from 'exceljs'
import {
  BLOCK_COLUMNS,
  META_COLUMNS,
  META_SHEET,
  SCHEMA_VERSION,
  WINDOWS_SHEET,
  WINDOW_COLUMNS,
} from '../../src/export/workbook-layout'

// CommonJS: the named import typechecks and throws at runtime. Work log §18.1.
const { Workbook } = ExcelJS

const DEFAULT_OUT = 'tools/xlsx-to-jsonl/fixtures/broken.xlsx'
const TZ = 'Asia/Kolkata'
const WINDOW_ID = '01KYD4PS300000000000000001'

/** The faults, named. `roundtrip.ts` imports this list and checks each one is caught. */
export const EXPECTED_FAULTS = [
  { id: 'duplicate-id', pattern: /duplicate id/i, spec: '§3.4' },
  { id: 'malformed-id', pattern: /malformed id/i, spec: '§3.3' },
  { id: 'date-cell', pattern: /date cell/i, spec: '§3.1' },
  { id: 'numeric-cell', pattern: /numeric cell/i, spec: '§3.1 / §3.10' },
  { id: 'merged-cells', pattern: /merged cells/i, spec: '§3.8' },
  { id: 'bad-date-format', pattern: /date must be YYYY-MM-DD/i, spec: '§3.1' },
] as const

/**
 * A valid ULID ending in `n`. EXACTLY 26 characters — the first draft of this helper
 * was 25 and every row in the fixture came back "malformed id", which masked every
 * other fault in the file. A fixture whose faults are the wrong faults is worse than no
 * fixture, so the length is asserted rather than counted by eye.
 */
const GOOD_ID = (n: number): string => {
  const id = `01KYEXW08${'0'.repeat(15)}${String(n).padStart(2, '0')}`
  if (id.length !== 26) throw new Error(`fixture id is ${id.length} chars, must be 26`)
  return id
}

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  columns: readonly { key: string; width: number }[],
  rows: Record<string, unknown>[],
): Worksheet {
  const ws = wb.addWorksheet(name)
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width }))
  ws.addRow(columns.map((c) => c.key))
  for (const row of rows) ws.addRow(columns.map((c) => row[c.key] ?? ''))
  // Everything text, except where a fault deliberately overrides it below.
  ws.eachRow((row) => row.eachCell((cell) => (cell.numFmt = '@')))
  return ws
}

async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? DEFAULT_OUT)
  const wb = new Workbook()
  wb.created = new Date('2026-08-01T10:00:00+05:30')
  wb.modified = wb.created

  addSheet(wb, META_SHEET, META_COLUMNS, [
    {
      schema_version: String(SCHEMA_VERSION),
      exported_at: '2026-08-01T10:00:00+05:30',
      source: 'broken-fixture',
      tz: TZ,
    },
  ])

  addSheet(wb, WINDOWS_SHEET, WINDOW_COLUMNS, [
    {
      id: WINDOW_ID,
      sheet: 'W01',
      label: 'deliberately broken',
      start: '2026-08-03',
      end: '2026-08-09',
      revision_id: WINDOW_ID,
    },
  ])

  const base = (id: string, title: string) => ({
    id,
    node_id: GOOD_ID(1),
    date: '2026-08-03',
    weekday: 'Mon',
    start: '07:00',
    end: '08:00',
    title,
    type: 'hobbies',
    magnitude: 'kilo',
    precision: 'exact',
    recurrence: 'weekly Mon,Wed,Fri',
    outcome: '',
    reason: '',
    follow_up_node_id: '',
    note: '',
    parents: '',
  })

  const rows: Record<string, unknown>[] = [
    base(GOOD_ID(10), 'valid row, so a clean row still survives a dirty file'),
    // §3.4 — copy-pasting a row is one keystroke.
    base(GOOD_ID(10), 'duplicate id'),
    // §3.3 — I, L, O and U are not in Crockford base32; a human retyped this one.
    base('01KYEXWO800000000000000IL', 'malformed id'),
    // §3.1 — a date that is not YYYY-MM-DD at all.
    { ...base(GOOD_ID(11), 'bad date format'), date: '03/08/2026' },
    { ...base(GOOD_ID(12), 'date written as a real date cell'), date: '2026-08-03' },
    { ...base(GOOD_ID(13), 'epoch ms as a number'), note: '' },
    // §3.6 — a blank row in the middle. Skipped, not reported: spreadsheets accumulate
    // these and a person deleting a row is curation, not corruption.
    {},
    base(GOOD_ID(14), 'formula cell in a text column'),
  ]

  const ws = addSheet(wb, 'W01', BLOCK_COLUMNS, rows)

  const col = (key: string) => BLOCK_COLUMNS.findIndex((c) => c.key === key) + 1

  // §3.1 — a genuine date cell. exceljs then hands the reader a `Date` for a column
  // that is a string everywhere else.
  const dateRow = ws.getRow(6)
  dateRow.getCell(col('date')).value = new Date(Date.UTC(2026, 7, 3))
  dateRow.getCell(col('date')).numFmt = 'yyyy-mm-dd'

  // §3.10 — epoch ms as a number. Excel renders it in scientific notation and a user
  // "fixes" the formatting, at which point the value is gone.
  const numberRow = ws.getRow(7)
  numberRow.getCell(col('note')).value = 1785695400000
  numberRow.getCell(col('note')).numFmt = 'General'

  // §3.7 — a formula cell arrives as { formula, result }, not a value.
  const formulaRow = ws.getRow(9)
  formulaRow.getCell(col('title')).value = {
    formula: 'CONCATENATE("Gym"," — push")',
    result: 'Gym — push',
  }

  // §3.8 — a merge inside the data range. Only the top-left cell carries a value.
  ws.mergeCells(`${colLetter(col('reason'))}2:${colLetter(col('note'))}2`)

  await mkdir(dirname(out), { recursive: true })
  await wb.xlsx.writeFile(out)
  console.log(`wrote ${out}`)
  console.log(`  ${EXPECTED_FAULTS.length} deliberate faults: ${EXPECTED_FAULTS.map((f) => f.id).join(', ')}`)
}

function colLetter(index: number): string {
  let n = index
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

// Only run when invoked directly — `roundtrip.ts` imports EXPECTED_FAULTS from here.
if (process.argv[1] && process.argv[1].endsWith('broken.ts')) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}

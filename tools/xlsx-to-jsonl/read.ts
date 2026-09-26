/**
 * read.ts — step 2 of SPEC §4. Workbook in, raw cell values out. NO interpretation.
 *
 * The split from `normalize.ts` is the point of this file: everything here is about
 * *exceljs being exceljs*, and everything there is about the data being right. Mixing
 * them produces a function where a formula-cell quirk and a business rule sit in the
 * same `if`, and neither can be tested without the other.
 *
 * So the contract is narrow: every cell comes out as a `string`, plus a list of
 * complaints about cells that could not honestly be turned into one. A `Date` or a
 * `number` reaching this layer means the *export* side is wrong (SPEC §3.1) — it is
 * reported, never silently decoded.
 */

import ExcelJS from 'exceljs'
import type { Worksheet } from 'exceljs'

/**
 * Default import, not `import { Workbook }`.
 *
 * exceljs is CommonJS with an ES-shaped `.d.ts`, so the named form typechecks clean and
 * then throws `does not provide an export named 'Workbook'` at runtime — Node's ESM
 * loader cannot find named exports by scanning it. Measured: the namespace's `.Workbook`
 * is undefined, `.default` is the whole `module.exports`. (Work log 2026-08-01 §18.1.)
 */
const { Workbook } = ExcelJS

export interface RawSheet {
  name: string
  /** Header row, verbatim. */
  header: string[]
  /** Data rows as objects keyed by header. Excel's 1-based row number is kept. */
  rows: { rowNumber: number; cells: Record<string, string> }[]
}

export interface RawWorkbook {
  sheets: RawSheet[]
  /** Anything structurally wrong at the cell level. Fatal-ness is decided downstream. */
  problems: ReadProblem[]
}

export interface ReadProblem {
  sheet: string
  row?: number
  column?: string
  message: string
}

export async function readWorkbook(path: string): Promise<RawWorkbook> {
  const wb = new Workbook()
  await wb.xlsx.readFile(path)

  const problems: ReadProblem[] = []
  const sheets: RawSheet[] = []

  wb.eachSheet((ws) => {
    sheets.push(readSheet(ws, problems))
  })

  return { sheets, problems }
}

function readSheet(ws: Worksheet, problems: ReadProblem[]): RawSheet {
  const name = ws.name

  /**
   * §3.8 — merged cells. Only the top-left of a merge carries a value; the rest read as
   * null, so a merge inside the data range silently blanks columns. Rejected with a
   * message rather than unmerged: a merge in a curation sheet means someone was
   * formatting it like a document, and quietly repairing that hides the fact.
   */
  const merges = (ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? []
  for (const range of merges) {
    problems.push({ sheet: name, message: `merged cells in the data range: ${range}` })
  }

  const headerRow = ws.getRow(1)
  const header: string[] = []
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    header[col - 1] = cellToString(cell.value, { sheet: name, row: 1, col }, problems)
  })

  const rows: RawSheet['rows'] = []
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const cells: Record<string, string> = {}
    let anyValue = false
    for (let col = 1; col <= header.length; col++) {
      const key = header[col - 1]
      if (!key) continue
      const value = cellToString(
        row.getCell(col).value,
        { sheet: name, row: rowNumber, col },
        problems,
      )
      cells[key] = value
      if (value !== '') anyValue = true
    }
    // §3.6 — spreadsheets accumulate blank rows and `rowCount` counts them. A row with
    // nothing at all in it is not worth reporting; one with an id is handled downstream.
    if (anyValue) rows.push({ rowNumber, cells })
  })

  return { name, header, rows }
}

type Where = { sheet: string; row: number; col: number }

/**
 * Every cell, to a string. The interesting cases, in the order they will bite:
 *
 *   §3.7  formula cells arrive as `{ formula, result }`, not a value. Read `.result`,
 *         or `[object Object]` lands in the training data and goes unnoticed for a month.
 *   §3.1  a `Date` or a `number` in a date/time column means the export wrote a real
 *         date cell. Reported, not decoded: decoding would mean implementing Excel's
 *         1900 leap-year bug, and the correct fix is on the writing side.
 *   rich text arrives as `{ richText: [...] }` — concatenated, since the formatting is
 *         not data.
 */
function cellToString(value: unknown, where: Where, problems: ReadProblem[]): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value

  if (typeof value === 'number') {
    problems.push({
      sheet: where.sheet,
      row: where.row,
      column: colLetter(where.col),
      message: `numeric cell (${value}) — the exporter must write every cell as text (SPEC §3.1)`,
    })
    return String(value)
  }

  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'

  if (value instanceof Date) {
    problems.push({
      sheet: where.sheet,
      row: where.row,
      column: colLetter(where.col),
      message:
        'date cell — exceljs returns Date | string | number for the same column ' +
        'depending on formatting. Write dates as text (SPEC §3.1)',
    })
    return value.toISOString()
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if ('result' in obj) {
      return cellToString(obj.result, where, problems)
    }
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return (obj.richText as { text?: string }[]).map((r) => r.text ?? '').join('')
    }
    if ('text' in obj && typeof obj.text === 'string') return obj.text
    if ('error' in obj) {
      problems.push({
        sheet: where.sheet,
        row: where.row,
        column: colLetter(where.col),
        message: `error cell: ${String(obj.error)}`,
      })
      return ''
    }
  }

  return String(value)
}

export function colLetter(index: number): string {
  let n = index
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

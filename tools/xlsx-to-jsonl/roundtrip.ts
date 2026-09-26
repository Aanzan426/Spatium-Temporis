/**
 * roundtrip.ts — "the test that matters" (SPEC §4).
 *
 *   npx tsx tools/xlsx-to-jsonl/roundtrip.ts
 *
 * There is no test runner in this project. There is also no excuse for a converter
 * whose only execution is by hand, so this is a plain script that exits non-zero: it
 * runs in CI, in a pre-push hook, or in a terminal, and needs no framework to do it.
 *
 * It checks four things, in order of how badly each would hurt:
 *
 *   1. EXPORT → READ → NORMALIZE → EMIT, and the rows that come out match the store
 *      that went in. If this holds, the workbook layout is real and the round trip is
 *      not lossy. It also exercises `src/export/xlsx.ts`'s hand-written zip and XLSX
 *      writer against a library that did not produce it, which is the only way to know
 *      the file is actually a spreadsheet rather than something Excel merely tolerates.
 *   2. Determinism (§3.12) — same input twice, byte-identical JSONL.
 *   3. Every deliberate fault in `broken.ts` is caught, and a clean row in a dirty file
 *      still survives.
 *   4. Local midnight — `date_ms` is midnight in `_meta.tz`, not midnight UTC (§3.2).
 */

import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { buildWorkbook, toXlsx } from '../../src/export/xlsx'
import { MemoryStore } from '../../src/store/memory/MemoryStore'
import { seed } from '../../src/store/memory/seed'
import { EXPECTED_FAULTS } from './broken'
import { rawEmitter, toJsonl } from './emit'
import { formatProblem, hasErrors, normalize } from './normalize'
import { readWorkbook } from './read'
import { zonedToUtcMs } from './tz'

const TMP = resolve('tools/xlsx-to-jsonl/fixtures/.roundtrip')

/**
 * The zone this process is actually running in — NOT a hardcoded one.
 *
 * Found by this script on its first run, and worth stating plainly: `_meta.tz` names
 * the zone the workbook's dates were RENDERED in, and `src/export/xlsx.ts` renders with
 * the machine's local calendar (date-fns, DESIGN §5.7). Passing a different zone in the
 * options produced dates in UTC labelled `Asia/Kolkata`, and every row then failed to
 * rejoin by exactly 5h30m — a corruption that would have been invisible in the workbook
 * and obvious only months later in the training data.
 *
 * The npm script runs this with `TZ=Asia/Kolkata` so the round trip is exercised in a
 * non-UTC zone rather than in the one where the bug hides.
 */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

let failures = 0

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function main(): Promise<void> {
  await mkdir(TMP, { recursive: true })

  // -----------------------------------------------------------------------
  // 1. the round trip
  // -----------------------------------------------------------------------
  const store = new MemoryStore()
  seed(store)

  const exportedAt = Date.UTC(2026, 7, 1, 4, 30)
  const data = buildWorkbook(store, { tz: TZ, exportedAt, source: 'roundtrip' })
  const bytes = toXlsx(data)
  const path = resolve(TMP, 'export.xlsx')
  await writeFile(path, bytes)

  const raw = await readWorkbook(path)
  const result = normalize(raw)
  for (const p of result.problems) console.log(`      ${formatProblem(p)}`)

  check('workbook written by src/export/xlsx.ts is readable by exceljs', raw.sheets.length > 0,
    `${raw.sheets.length} sheets`)
  check('no validation errors', !hasErrors(result.problems))

  const expectedRows = data.sheets.reduce((n, s) => n + s.rows.length, 0)
  check('every exported row survived the trip', result.counts.rows === expectedRows,
    `exported ${expectedRows}, read back ${result.counts.rows}`)

  // The claim that matters: each row still points at the occurrence it came from, and
  // its content is unchanged. This is what the `id` column exists for (SPEC §3.3).
  const occurrences = new Map(store.listOccurrences().map((o) => [o.id, o]))
  const nodes = new Map(store.listNodes().map((n) => [n.id, n]))
  let rejoined = 0
  let mismatched = 0
  for (const row of result.data?.rows ?? []) {
    const occ = occurrences.get(row.id)
    if (!occ) {
      mismatched++
      continue
    }
    rejoined++
    if (occ.node_id !== row.node_id) mismatched++
    else if ((nodes.get(occ.node_id)?.title ?? '') !== row.title) mismatched++
    // `date_ms` is local midnight on both sides, so it must be equal on the nose.
    else if (occ.date_ms !== row.date_ms) mismatched++
  }
  check('every row rejoins to its occurrence on id', rejoined === result.counts.rows,
    `${rejoined}/${result.counts.rows}`)
  check('rejoined rows match the store', mismatched === 0, `${mismatched} mismatched`)

  // -----------------------------------------------------------------------
  // 2. determinism (§3.12)
  // -----------------------------------------------------------------------
  const first = toJsonl(rawEmitter, result.data!)
  const second = toJsonl(rawEmitter, normalize(await readWorkbook(path)).data!)
  check('JSONL is byte-identical across runs', first === second,
    `${first.length} bytes, ${first.split('\n').length - 1} records`)

  /**
   * The WORKBOOK is deliberately not checked for byte-equality. The app's writer stamps
   * a fixed DOS timestamp so it happens to be stable, but exceljs is not (work log
   * §16.3: archiver stamps wall-clock per zip entry). §3.12 is a requirement on the
   * JSONL, which is plain text, and that is the one asserted above.
   */

  // -----------------------------------------------------------------------
  // 3. the broken fixture
  // -----------------------------------------------------------------------
  const brokenPath = resolve(TMP, 'broken.xlsx')
  await runBrokenGenerator(brokenPath)

  const brokenResult = normalize(await readWorkbook(brokenPath))
  const messages = brokenResult.problems.map((p) => p.message)
  for (const fault of EXPECTED_FAULTS) {
    check(
      `${fault.spec} ${fault.id} is caught`,
      messages.some((m) => fault.pattern.test(m)),
      messages.some((m) => fault.pattern.test(m)) ? '' : `saw: ${messages.join(' | ')}`,
    )
  }
  check('a clean row in a dirty file still survives',
    (brokenResult.data?.rows.length ?? 0) >= 1,
    `${brokenResult.data?.rows.length ?? 0} rows kept`)

  // -----------------------------------------------------------------------
  // 4. §3.2 — the timezone trap
  // -----------------------------------------------------------------------
  const naive = new Date('2026-08-03').getTime()
  const correct = zonedToUtcMs('2026-08-03', '00:00', TZ)
  check('local midnight in tz is not midnight UTC', naive !== correct,
    `UTC ${new Date(naive).toISOString()} vs ${TZ} ${new Date(correct).toISOString()}`)
  check('midnight in Asia/Kolkata is 18:30 UTC the previous day',
    new Date(correct).toISOString() === '2026-08-02T18:30:00.000Z')

  // A zone west of Greenwich, where the naive parse lands on the wrong DAY rather than
  // merely the wrong hour — the actual failure §3.2 describes.
  const ny = zonedToUtcMs('2026-08-03', '00:00', 'America/New_York')
  check('and a negative-offset zone lands on the following UTC day',
    new Date(ny).toISOString() === '2026-08-03T04:00:00.000Z')

  await rm(TMP, { recursive: true, force: true })

  console.log()
  console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

/**
 * The broken fixture is generated by running its module, not by importing its `main` —
 * it is a CLI whose entry point is guarded, and duplicating its body here would create
 * exactly the second definition this project keeps refusing to have.
 */
async function runBrokenGenerator(out: string): Promise<void> {
  const { execFileSync } = await import('node:child_process')
  execFileSync(
    process.execPath,
    [resolve('node_modules/tsx/dist/cli.mjs'), resolve('tools/xlsx-to-jsonl/broken.ts'), out],
    { stdio: 'pipe' },
  )
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})

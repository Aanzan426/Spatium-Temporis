/**
 * cli.ts — step 5 of SPEC §4. Arguments, wiring, JSONL to stdout.
 *
 *   npx tsx tools/xlsx-to-jsonl/cli.ts workbook.xlsx --emitter raw > out.jsonl
 *   npx tsx tools/xlsx-to-jsonl/cli.ts workbook.xlsx -o exports/blocks.jsonl
 *   npx tsx tools/xlsx-to-jsonl/cli.ts workbook.xlsx --check
 *
 * DATA ON STDOUT, EVERYTHING ELSE ON STDERR. That is what makes `> out.jsonl` correct
 * rather than a file with a progress report at the top of it. The counts and warnings
 * still appear on the terminal while the redirect is running, which is the behaviour
 * you want when something looks wrong mid-export.
 *
 * Exit codes: 0 clean, 1 validation errors, 2 could not read the file at all. A
 * non-zero exit on validation errors is what stops a broken workbook silently
 * becoming a training set in a shell pipeline.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { EMITTERS, emitterByName, toJsonl } from './emit'
import { formatProblem, hasErrors, normalize } from './normalize'
import { readWorkbook } from './read'

interface Args {
  input: string
  emitter: string
  out: string | null
  check: boolean
  strict: boolean
}

function parseArgs(argv: string[]): Args | null {
  const args: Args = { input: '', emitter: 'raw', out: null, check: false, strict: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--emitter' || a === '-e') args.emitter = argv[++i] ?? 'raw'
    else if (a === '--out' || a === '-o') args.out = argv[++i] ?? null
    else if (a === '--check') args.check = true
    // Warnings are curation notes, not defects, so they do not fail a run by default.
    // `--strict` is for the day this runs unattended and nobody reads the terminal.
    else if (a === '--strict') args.strict = true
    else if (a === '--help' || a === '-h') return null
    else if (a.startsWith('-')) {
      console.error(`unknown option ${a}`)
      return null
    } else args.input = a
  }
  return args.input ? args : null
}

function usage(): void {
  console.error(`xlsx → jsonl

  npx tsx tools/xlsx-to-jsonl/cli.ts <workbook.xlsx> [options]

  -e, --emitter <name>   ${EMITTERS.map((e) => e.name).join(', ')}   (default: raw)
  -o, --out <path>       write here instead of stdout
      --check            validate only, emit nothing
      --strict           treat warnings as errors

emitters:
${EMITTERS.map((e) => `  ${e.name.padEnd(10)} ${e.description}`).join('\n')}`)
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    usage()
    return 2
  }

  const emitter = emitterByName(args.emitter)
  if (!emitter) {
    console.error(`unknown emitter "${args.emitter}" — have: ${EMITTERS.map((e) => e.name).join(', ')}`)
    return 2
  }

  const path = resolve(args.input)
  let raw
  try {
    raw = await readWorkbook(path)
  } catch (err) {
    console.error(`cannot read ${path}: ${(err as Error).message}`)
    return 2
  }

  const { data, problems, counts } = normalize(raw)

  for (const p of problems) console.error(formatProblem(p))

  /**
   * §3.5 — report the counts. Deleting rows is legitimate curation, so the drop is not
   * an error; silent loss is the failure mode, because it looks identical to a parsing
   * bug that ate rows.
   */
  console.error(
    `${counts.sheets} window sheets, ${counts.rows} rows kept, ${counts.skipped} without an id (dropped by curation)`,
  )

  const fatal = hasErrors(problems) || (args.strict && problems.length > 0)
  if (!data || fatal) {
    console.error(fatal ? 'validation failed — nothing emitted' : 'nothing to emit')
    return 1
  }

  if (args.check) {
    console.error('ok')
    return 0
  }

  const jsonl = toJsonl(emitter, data)
  if (args.out) {
    const out = resolve(args.out)
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, jsonl, 'utf8')
    console.error(`wrote ${out} (${jsonl.split('\n').length - 1} records, emitter "${emitter.name}")`)
  } else {
    process.stdout.write(jsonl)
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err)
    process.exit(2)
  },
)

# xlsx → jsonl — specification

Written 2026-08-01. Build from this; change it where it's wrong and note why.

## What this is for

The loop: **export from the app → curate by hand in a spreadsheet → convert to training
JSONL → fine-tune locally.** The spreadsheet is where a human decides what is worth training
on. This tool is the last step before training.

## What is knowable now, and what isn't

**Knowable:** reading a workbook into normalized, validated records. The schema is pinned in
`docs/DESIGN.md` §2, so the columns, types and joins are all decidable today.

**Not knowable:** what a *training example* looks like. That depends entirely on the task
being fine-tuned for, and it hasn't been chosen. Candidates are structurally different:

- *plan state + a new thought → where does it belong?* — classification
- *a goal → its decomposition into sub-nodes* — generation
- *history → how this person re-plans when something slips* — sequence over the event log

Writing one now means writing four and discarding three.

**So:** build the reader and a pluggable emitter interface. Ship exactly one emitter — `raw`,
which dumps normalized records verbatim as JSONL. That's immediately useful for seeing what
you actually have. Training emitters land when there's a task.

## Why build this before the exporter exists

Nothing exports yet, so testing this means defining the workbook layout — which makes **this
tool the specification that `src/export/xlsx.ts` has to satisfy.** Consumer-first. The
exporter gets a concrete target instead of inventing one, and the round trip is provable
before either side touches a database.

---

## 1. Workbook layout

**One sheet per revision window**, plus two metadata sheets. A revision window is the
interval between two consecutive revisions (`DESIGN.md` §9) — no table exists or is needed.

> **Naming.** "Period" is retired — it got used for both this interval and for a single
> scheduled slot. A slot is a **block**; the interval is a **revision window**.

Human curation happens **only** in the window sheets. The `_`-prefixed sheets are carried
through untouched.

### `_meta` — one data row

| column | type | notes |
|---|---|---|
| `schema_version` | int | bump when this layout changes; the reader must reject unknown versions rather than guess |
| `exported_at` | ISO 8601 text | with offset |
| `source` | text | database file or app build |
| `tz` | IANA name | e.g. `Asia/Kolkata` — **every date in the workbook is local to this** |

### `_windows` — one row per revision window

| column | type |
|---|---|
| `id` | ULID |
| `sheet` | text — the sheet name holding this window's rows |
| `label` | text — the revision's label, or blank |
| `start` | ISO date |
| `end` | ISO date |
| `revision_id` | ULID |

### No event sheet — events are a separate export

Events do **not** belong in the schedule workbook. They have a different lifecycle, different
curation rules and a different shape: window sheets exist to be hand-edited, event logs are
never edited at all. Putting both in one file gives you an export that is half-curated and
half-raw, and a converter forced to branch on which sheet it is looking at.

Events get their own export, their own converter path and their own emitters.

### Window sheets — one row per block

Sheet named `W01`, `W02`, … (see §3.11 on why the label doesn't go in the sheet name).

A **block** is one start–end slot with a category — `07:00–08:00 sleep`, `09:00–17:00 work`
(`DESIGN.md` § Blocks and contents). It is an `occurrences` row; its category is the node's
`type`. This sheet is the *framework* layer only: what was planned.

**What actually happened inside a block is not here.** Contents — which book and how many
pages, which route, that a language app got used during the commute — are separate nodes
joined to the block by edges, precisely so one content node can sit in several contexts at
once. They get their own emitter, because they are a different shape entirely.

Denormalized deliberately: a human has to be able to read and edit this without joining
anything. The `id` columns are what make it rejoinable afterwards.

| column | source | notes |
|---|---|---|
| `id` | `occurrences.id` | **rejoin key — never edit** |
| `node_id` | `nodes.id` | **rejoin key — never edit** |
| `date` | `occurrences.date_ms` | `YYYY-MM-DD`, local |
| `weekday` | derived | `Mon`…`Sun` — see below |
| `start` | `occurrences.start_ms` | `HH:MM` local, blank if none |
| `end` | `occurrences.end_ms` | `HH:MM` local, blank if none |
| `title` | `nodes.title` | |
| `type` | `nodes.type` | may be blank — capture is never gated on it |
| `magnitude` | `nodes.magnitude` | micro…tera |
| `precision` | `spans.start_precision` | exact…someday |
| `recurrence` | `recurrences` → text | e.g. `weekly Mon,Wed,Fri` |
| `outcome` | `occurrences.outcome` | `done \| skipped \| partial \| moved`. Blank through Phase 1 |
| `reason` | `occurrences.reason` | why, when the outcome is a miss. Blank through Phase 1 |
| `follow_up_node_id` | `occurrences.follow_up_node_id` | the node created in response to a miss |
| `note` | `occurrences.note` | **the main free-text curation field** |
| `parents` | `edges` → titles | `; `-separated, readable |

Rows are sorted by `date`, then `start`, then `id`. Export with the header row frozen and
autofilter on.

#### Why rows are blocks and not Mon–Sun columns

A weekly grid is how a schedule *reads*, so a column-per-day layout is the obvious instinct.
It cannot work here, for a concrete reason: **each scheduled thing carries four fields**
(`id`, `outcome`, `reason`, `follow_up_node_id`), and a column-per-day gives it one cell.

Pairing shadow columns per day — `Mon | Mon.outcome | Mon.reason | Mon.follow_up | Tue | …` —
reaches 28 columns for a single week and still has nowhere to put the id. An id with nowhere
to live is a round trip that cannot be made (§3.3).

`weekday` as a column recovers everything that layout was for: sort by weekday and time to
see the rhythm, filter to one day in a click, and every field stays individually editable
and rejoinable.

**If the literal grid is wanted**, generate a read-only `_grid` sheet per window: purely
visual, rebuilt on every export, **ignored by the reader**, and labelled as not-curated. It
must never be a place edits are made, or there are two sources of truth and they will drift.

---

## 2. Types — one definition, derived everywhere

**The column list is not written down more than once.** It lives in
`src/export/workbook-layout.ts` as `as const` arrays, and the row types are *derived* from
them:

```ts
export const BLOCK_COLUMNS = [ /* … */ ] as const satisfies readonly ColumnDef[]
type RowOf<T extends readonly ColumnDef[]> = { [K in T[number]['key']]: string }
export type BlockRow = RowOf<typeof BLOCK_COLUMNS>
```

Add a column and `BlockRow` changes on its own; every file that builds or reads a row stops
compiling until it handles the new field. Verified — adding a column to the array produces
`Property 'energy' is missing … but required in type 'BlockRow'` in `sample.ts`.

Three consumers import it and none of them declare columns: `src/export/xlsx.ts` (the real
export), `sample.ts` (the fixture), `normalize.ts` (the reader).

**Why it isn't generated from the SQL schema.** A window sheet is not a table — it is a
denormalized view joining `occurrences`, `nodes`, `spans`, `recurrences` and `edges`. No
`CREATE TABLE` contains those columns, so no DDL parsing produces this layout. Keep the DDL
in `001_init.sql` where it is clearest, and assert the two agree at runtime with
`PRAGMA table_info(...)` in a test — far more robust than parsing your own SQL dialect.

The remaining shapes are yours to write:

```ts
type Meta = { schemaVersion: number; exportedAt: string; source: string; tz: string }
type RevisionWindow = { id: string; sheet: string; label: string | null; start: string; end: string; revisionId: string }
type Normalized = {
  meta: Meta
  windows: RevisionWindow[]
  rows: BlockRow[]           // flattened across all window sheets, each carrying its windowId
}

/**
 * An emitter is one (domain x task) pair, not one per domain — "schedule adherence:
 * why things get missed" and "schedule structure: how a week gets laid out" are two
 * emitters over identical rows.
 *
 * Ship only `raw` for now (§ What is knowable).
 */
interface Emitter {
  name: string
  /** one object per JSONL line */
  emit(data: Normalized): Iterable<object>
}
```

---

## 3. The edge cases that will actually bite

Ordered by how much time each will cost you if you meet it unprepared.

### 3.1 Excel dates are a trap, and the worst one here

Excel stores dates as serial numbers counted from 1899-12-30, including a deliberate
[1900 leap-year bug](https://learn.microsoft.com/office/troubleshoot/excel/wrongly-assumes-1900-is-leap-year)
kept for Lotus 1-2-3 compatibility. Worse, `exceljs` returns a `Date`, a `string`, or a
`number` for the same column depending on how the cell happens to be formatted.

**Write every date and time as TEXT**, with the cell explicitly typed as text — never as a
date cell. On read, accept `string | Date | number` and normalize, and **fail loudly** on a
number rather than trying to decode a serial. If you find yourself writing serial-date
arithmetic, stop: the export side is wrong.

### 3.2 Timezones will silently shift days

`new Date('2026-08-01')` is parsed as **midnight UTC**. In any negative-offset timezone that
is the previous day. This is the same class of bug as `occurrences.date_ms` being local
midnight (`DESIGN.md` §5.7) and it produces the same symptom: a scattering of rows on the
wrong day, looking exactly like corruption.

Use `_meta.tz`. Never construct a `Date` from a bare date string without an explicit offset.

### 3.3 An edited `id` breaks everything

The whole round trip rests on `id`. A human retyping or autofilling one destroys the rejoin
silently.

Validate: 26 characters, Crockford base32 (`0-9A-HJKMNP-TV-Z`, no I/L/O/U). Any row whose id
fails to parse is a **hard error naming the sheet and the row number**, not a skip.

> **Workbook-only, for now.** The converter takes the `.xlsx` and nothing else — no database
> handle. For the schedule framework the workbook is self-sufficient: every field it needs is
> already in the sheet, so id validation is *format-only*. Existence checking against the
> database becomes necessary when **contents** emitters arrive, because contents are nodes and
> edges that never appear in the workbook at all.

### 3.4 Duplicate ids

Copy-pasting a row in a spreadsheet is one keystroke and produces two rows with the same id.
Detect it and fail with *both* row numbers.

### 3.5 A deleted row is meaningful, not an error

Deleting a row is a human saying "don't train on this". That's the point of curation.

But **report the count**: `312 rows in source, 287 in workbook, 25 dropped`. Silent loss is
the failure mode — it looks identical to a parsing bug that ate rows.

### 3.6 Blank rows

Spreadsheets accumulate them, and `worksheet.rowCount` counts them. Skip any row with no
`id`. Don't skip rows that merely have empty *other* cells — a blank `note` is normal.

### 3.7 Formula cells

`exceljs` returns `{ formula, result }` for these, not a value. Read `.result`, or you will
write `[object Object]` into your training data and not notice for a month.

### 3.8 Merged cells

Only the top-left cell of a merge carries a value; the rest read as `null`. Either unmerge on
read or reject merges in the data range with a clear message.

### 3.9 Excel mangles values that *look* like something else

A title of `3-4` becomes a date. `+1` becomes a formula error. Read cell values as text
wherever the column is text, and on export set the cell type explicitly rather than letting
Excel infer.

### 3.10 Don't write epoch milliseconds as numbers

They're within float-safe range, but Excel renders large integers in scientific notation and
a user will helpfully "fix" the formatting. ISO text throughout (which §3.1 already requires).

### 3.11 Sheet names have hard limits

Max 31 characters, and `: \ / ? * [ ]` are illegal. Window labels are user-supplied
("exam prep", "Q3 / push"), so they cannot be sheet names directly — sanitizing two different
labels can also collide.

Name sheets `W01`, `W02`, … and keep the real label in `_windows.label`.

### 3.12 Output must be deterministic

Same workbook in → byte-identical JSONL out, so generated datasets can be diffed.

- stable sort (by window, then `date`, then `start`, then `id`)
- stable JSON key order
- no timestamps in the output — carry `_meta.exportedAt` through instead

**This applies to the JSONL, not to the `.xlsx`.** A workbook is a zip, and exceljs calls
`zip.append(data, {name})` with no `date`, so archiver stamps every entry with wall-clock
time. Measured on two consecutive runs of `sample.ts`: every XML entry inside is byte-
identical, only the zip `date_time` moves. Not reachable through exceljs's API, and it does
not matter — the workbook is a regenerable fixture. Compare workbooks by entry content, never
by file hash.

---

## 4. Build order

One file per step, each testable before the next exists.

1. **`sample.ts`** — writes a workbook matching §1 from hardcoded fake data. Do this first:
   without it there is nothing to read, and it doubles as the spec `src/export/xlsx.ts` must
   satisfy.
2. **`read.ts`** — workbook → raw cell values per sheet. No interpretation yet.
3. **`normalize.ts`** — raw values → typed records + a list of validation errors. Every case
   in §3 lives here; this file gets big on its own.
4. **`emit.ts`** — the `Emitter` interface and the `raw` emitter.
5. **`cli.ts`** — argument parsing, wiring, JSONL to stdout.

### Where things live

| what | where | committed? |
|---|---|---|
| converter source | `tools/xlsx-to-jsonl/*.ts` | yes |
| fixture workbooks | `tools/xlsx-to-jsonl/fixtures/*.xlsx` | no — `*.xlsx` is gitignored; regenerate with `sample.ts` |
| generated JSONL | `exports/` | no — `/exports/` and `*.jsonl` are both gitignored |

`exports/` and not `export/`: `src/export/` already exists and holds the app's exporter
*code*. Two directories one character apart, one holding code and one holding personal data,
is a mistake waiting to happen.

Those gitignore lines matter more than the naming. This repository is public and the JSONL is
an entire inner life.

**The test that matters:** generate → read → normalize → emit, and assert the emitted records
match the fake data that went in. If the round trip holds, the layout is real.

### Two fixtures, not one

The generator produces **valid** data — which means every error path in §3 goes untested,
because valid input never triggers one.

So write a second fixture that is deliberately broken: a duplicate `id`, a malformed `id`, a
formula cell, a merged cell in the data range, a date written as a serial number, a blank row
in the middle. That fixture asserts the errors actually fire, and it is the only way §3 is
worth anything.

## 5. Language and dependencies

**TypeScript**, run with `tsx`.

The reason is the contract, not ergonomics: the converter and `src/export/xlsx.ts` are two
ends of one format, and the converter currently *is* that format's specification. Sharing the
`BlockRow` type means the two cannot drift. Written in Python, the layout would exist twice in
two languages, and the day they diverge produces a silently wrong dataset instead of a compile
error.

The pull toward Python is real — `openpyxl` is already installed, `zoneinfo` beats anything JS
has for §3.2, and every fine-tuning tool downstream is Python. It resolves cleanly:

> **JSONL is the language boundary.** That is why it was chosen. TypeScript up to the file,
> Python from the file onward. Nothing crosses that line but bytes.

```bash
npm i -D exceljs tsx
npx tsx tools/xlsx-to-jsonl/cli.ts sample.xlsx --emitter raw > out.jsonl
```

Node 20 cannot strip types natively — that landed in 22.6 — hence `tsx` the *runner*, which
unhelpfully shares a name with the JSX file extension. Source files here are `.ts`; a `.tsx`
file makes the compiler expect JSX and a stray `<` in a generic produces baffling errors.

Add `"tools"` to `tsconfig.json`'s `include`, or none of this gets typechecked.

**Not SheetJS (`xlsx`) from npm.** It is frozen at 0.18.5 from 2022 — SheetJS moved
distribution to their own registry — and that version carries an unpatched prototype-pollution
advisory whose fix only exists in releases npm never received. `exceljs` 4.4.0 is maintained,
is actually on npm, and writes as well as reads, which step 1 needs.

Both are devDependencies of the root package. The app itself never imports either.

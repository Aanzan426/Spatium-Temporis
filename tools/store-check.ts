/**
 * store-check.ts — the assertions that guard the invariants replay depends on.
 *
 *   npx tsx tools/store-check.ts
 *
 * DESIGN.md §5.4 asks for exactly one of these: "write a throwaway script that replays
 * the whole log and asserts the result equals current state. Ten minutes, and it is the
 * difference between having a revision feature and thinking you have one." It turned
 * out to be worth keeping rather than throwing away, because it also runs the SQL.
 *
 * What it covers, and why each one is here rather than trusted:
 *
 *   1. REPLAY EQUALS STATE. If a payload is missing a field, every revision view is
 *      quietly wrong and nothing else notices — the app reads the tables, not the log,
 *      so the corruption is invisible until the day the log is the only copy left.
 *   2. `replayAt` equals N separate replays. The one-pass optimization in the revision
 *      strip is only safe if it is genuinely the same answer.
 *   3. THE FROZEN PAST. Editing a recurrence rule must not rewrite history (§5.5).
 *   4. `materializePast` is idempotent, because it runs on every open.
 *   5. THE SQL ACTUALLY RUNS. `001_init.sql` executes, `SqliteStore` persists through
 *      it, and a fresh store loaded from the same database is identical. Without this,
 *      the schema's first execution would be in a browser, by hand, months from now.
 *
 * `node:sqlite` is Node 22's built-in SQLite: no npm package, no build step, no wasm —
 * which is what makes running the real schema here cheap enough to do on every change.
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { addDays, localMidnight, now } from '../src/core/time'
import { nodeSqliteAdapter } from '../src/store/sqlite/adapters/node-sqlite'
import { replayAt } from '../src/store/events'
import { MemoryStore } from '../src/store/memory/MemoryStore'
import { seed } from '../src/store/memory/seed'
import { SqliteStore } from '../src/store/sqlite/SqliteStore'
import type { DatabaseSnapshot, Store } from '../src/store/Store'

let failures = 0

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/** Stable key order, so two structurally equal rows compare equal as text. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  )

const sortedRows = (rows: readonly unknown[]): string[] => rows.map(stable).sort()

function sameSnapshot(a: DatabaseSnapshot, b: DatabaseSnapshot): string[] {
  const diffs: string[] = []
  for (const key of Object.keys(a) as (keyof DatabaseSnapshot)[]) {
    const left = sortedRows(a[key])
    const right = sortedRows(b[key])
    if (left.length !== right.length) {
      diffs.push(`${key}: ${left.length} vs ${right.length}`)
      continue
    }
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) {
        diffs.push(`${key}[${i}]:\n    A ${left[i]}\n    B ${right[i]}`)
        break
      }
    }
  }
  return diffs
}

// ---------------------------------------------------------------------------
// 1. replay equals state
// ---------------------------------------------------------------------------

function checkReplay(store: Store, label: string): void {
  const live = store.snapshot()
  const world = store.replayTo(Date.now() + 1)

  const replayed: DatabaseSnapshot = {
    nodes: [...world.nodes.values()],
    spans: [...world.spans.values()],
    edges: [...world.edges.values()],
    // The log cannot contain itself, so it is carried across rather than replayed.
    events: live.events,
    recurrences: [...world.recurrences.values()],
    occurrences: [...world.occurrences.values()],
    revisions: [...world.revisions.values()],
    node_types: [...world.nodeTypes.values()],
  }

  const diffs = sameSnapshot(live, replayed)
  check(`${label}: replaying the whole log reproduces current state`, diffs.length === 0,
    diffs.length ? diffs.slice(0, 2).join('; ') : `${live.events.length} events`)
}

// ---------------------------------------------------------------------------

function main(): void {
  const store = new MemoryStore()
  seed(store)

  checkReplay(store, 'MemoryStore')

  // --- 2. one pass == N passes ------------------------------------------
  const events = store.allEvents()
  const boundaries = [
    events[Math.floor(events.length * 0.25)]!.ts,
    events[Math.floor(events.length * 0.5)]!.ts,
    events[events.length - 1]!.ts,
  ]
  const onePass = replayAt(events, boundaries)
  const separately = boundaries.map((ts) => store.replayTo(ts))
  const equal = onePass.every((w, i) => {
    const a = stable([...w.nodes.values()].sort((x, y) => x.id.localeCompare(y.id)))
    const b = stable([...separately[i]!.nodes.values()].sort((x, y) => x.id.localeCompare(y.id)))
    return a === b
  })
  check('replayAt (one forward pass) equals N independent replays', equal,
    `${boundaries.length} boundaries over ${events.length} events`)

  // --- 3. the frozen past -------------------------------------------------
  const gym = store.listNodes().find((n) => n.title === 'Gym')!
  const before = store
    .listOccurrences()
    .filter((o) => o.node_id === gym.id)
    .map((o) => o.date_ms)
    .sort()

  // "gym Mon/Wed/Fri" becomes "gym Tue/Thu". Last month must still show Mon/Wed/Fri.
  store.setRecurrence(gym.id, {
    kind: 'weekly',
    weekdays: [2, 4],
    from_ms: localMidnight(now()),
    start_min: 6 * 60,
    end_min: 7 * 60 + 30,
  })

  const after = store
    .listOccurrences()
    .filter((o) => o.node_id === gym.id)
    .map((o) => o.date_ms)
    .sort()
  check('editing a recurrence rule does not rewrite past occurrences',
    stable(before) === stable(after), `${before.length} frozen rows`)

  // And the future does follow the new rule: everything projected from tomorrow on is
  // a Tuesday or a Thursday.
  const future = store
    .blocksInRange(addDays(localMidnight(now()), 1), addDays(localMidnight(now()), 15))
    .filter((b) => b.node_id === gym.id)
  const weekdaysSeen = new Set(future.map((b) => new Date(b.date_ms).getDay()))
  check('future occurrences do follow the new rule',
    future.length > 0 && [...weekdaysSeen].every((d) => d === 2 || d === 4),
    `projected on weekdays ${[...weekdaysSeen].join(',')}`)

  // --- 4. idempotent materialization -------------------------------------
  const yesterday = addDays(localMidnight(now()), -1)
  const second = store.materializePast(yesterday)
  check('materializePast is idempotent', second === 0, `${second} rows written on re-run`)

  checkReplay(store, 'MemoryStore after edits')

  // --- 5. the SQL ---------------------------------------------------------
  const migration = readFileSync(
    resolve('src/store/sqlite/migrations/001_init.sql'),
    'utf8',
  )
  const db = new DatabaseSync(':memory:')
  const adapter = nodeSqliteAdapter(db)

  let sqlStore: SqliteStore
  try {
    sqlStore = SqliteStore.open(adapter, migration)
    check('001_init.sql executes', true)
  } catch (err) {
    check('001_init.sql executes', false, (err as Error).message)
    finish()
    return
  }

  seed(sqlStore)
  check('SqliteStore: the in-memory mirror matches the database',
    sqlStore.verifyMirror().length === 0,
    sqlStore.verifyMirror().slice(0, 1).join('') || 'identical')

  checkReplay(sqlStore, 'SqliteStore')

  // The load path: a second store over the same database must be the same store. This
  // is what proves persistence is complete rather than merely present.
  const reopened = SqliteStore.open(adapter, migration)
  const diffs = sameSnapshot(sqlStore.snapshot(), reopened.snapshot())
  check('reopening the database reproduces the store exactly', diffs.length === 0,
    diffs.length ? diffs.slice(0, 2).join('; ') : `${reopened.snapshot().events.length} events reloaded`)

  // The indexes exist and the unique ones are doing their job.
  const indexes = adapter
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")
    .map((r) => r.name)
  check('the schema created its indexes', indexes.length >= 10, `${indexes.length}: ${indexes.join(', ')}`)

  let rejected = false
  try {
    adapter.run(
      'INSERT INTO occurrences (id, node_id, date_ms, created_at) SELECT ?, node_id, date_ms, ? FROM occurrences LIMIT 1',
      ['01KYEXW08000000000000000Z', Date.now()],
    )
  } catch {
    rejected = true
  }
  check('occurrences(node_id, date_ms) is unique — the idempotency guarantee', rejected)

  db.close()
  finish()
}

function finish(): void {
  console.log()
  console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main()

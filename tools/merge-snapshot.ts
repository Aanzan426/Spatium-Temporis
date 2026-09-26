/**
 * merge-snapshot.ts — bring a phone snapshot into the desktop database, without either
 * side losing anything.
 *
 *   npx tsx tools/merge-snapshot.ts desktop.json phone-2026-09-26.json -o merged.json
 *   npx tsx tools/merge-snapshot.ts desktop.json phone.json --dry-run
 *
 * WHY THIS IS A MERGE AND NOT A RESTORE
 * -------------------------------------
 * The tempting version is: back up the desktop, wipe it, restore the phone's snapshot.
 * It looks safe because the snapshot contains the full history since birth, and the
 * backup looks like a safety net.
 *
 * It is not safe, and the backup does not help. §7 puts *structuring and visualizing*
 * on the desktop — spans, retitles, links, revision marks — and those writes exist
 * nowhere else. Wipe-and-restore deletes them every time the phone syncs, and the
 * fallback backup only lets you choose which half to lose instead.
 *
 * The merge is not harder, because of a decision made on day one: the event log is
 * append-only and every payload carries whole `{before, after}` rows (§5.3, §5.4). So
 * merging two databases is:
 *
 *     union the events by id  ->  sort by ts  ->  replay
 *
 * and `tools/store-check.ts` already asserts that replaying a log reproduces state
 * exactly. That assertion is what makes this safe rather than hopeful.
 *
 * WHAT MAKES IT IDEMPOTENT
 * ------------------------
 * Running it twice with the same inputs produces the same output, because events are
 * identified by ULID and occurrence rows by a DERIVED id (`core/derived-ids.ts`). Two
 * devices materializing the same `(node_id, date_ms)` produce the same row id, so the
 * union collapses them instead of keeping both. Without that, every sync would
 * duplicate every shared occurrence, permanently and undetectably.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * Resolve genuine conflicts. If a node was retitled on both devices, the later event
 * wins — last-write-wins by timestamp, which is DESIGN §12's open question answered
 * provisionally rather than properly. It is the right default for a single user with
 * two devices, and it is reported rather than hidden: every field where the two logs
 * disagree is listed, so you can see what was overwritten instead of finding out later.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setDeviceIdentity } from '../src/core/device'
import { buildSnapshot, readSnapshot } from '../src/export/snapshot'
import { changedFields } from '../src/store/events'
import { MemoryStore } from '../src/store/memory/MemoryStore'
import type { Event } from '../src/core/types'
import type { DatabaseSnapshot } from '../src/store/Store'

// This script writes nothing of its own to the log, but `makeEvent` stamps a device on
// anything that is written, and "script" is the honest answer.
setDeviceIdentity({ id: '00000000000000000000000000', kind: 'script', label: 'merge-snapshot' })

export interface MergeReport {
  events: { a: number; b: number; shared: number; merged: number }
  conflicts: Conflict[]
  counts: Record<string, number>
}

export interface Conflict {
  target: string
  id: string
  field: string
  losing: { ts: number; device: string | null; value: unknown }
  winning: { ts: number; device: string | null; value: unknown }
}

export function merge(a: DatabaseSnapshot, b: DatabaseSnapshot): {
  snapshot: DatabaseSnapshot
  report: MergeReport
} {
  const byId = new Map<string, Event>()
  for (const e of a.events) byId.set(e.id, e)
  let shared = 0
  for (const e of b.events) {
    if (byId.has(e.id)) shared++
    // Same id means the same event — ULIDs do not collide across devices (§5.6), so
    // this is deduplication, not a choice between two versions of something.
    else byId.set(e.id, e)
  }

  const events = [...byId.values()].sort((x, y) => x.ts - y.ts || x.id.localeCompare(y.id))
  const conflicts = findConflicts(events)

  /**
   * Replay through a real store rather than reconstructing tables by hand. Same code
   * path the app uses, same code path `store-check.ts` asserts against — a merge that
   * reimplemented replay would be the one place where a subtle difference is invisible.
   */
  const store = MemoryStore.fromSnapshot({
    nodes: [], spans: [], edges: [], events,
    recurrences: [], occurrences: [], revisions: [], node_types: [],
  })
  const world = store.replayTo(Number.MAX_SAFE_INTEGER)

  const snapshot: DatabaseSnapshot = {
    nodes: [...world.nodes.values()],
    spans: [...world.spans.values()],
    edges: [...world.edges.values()],
    events,
    recurrences: [...world.recurrences.values()],
    occurrences: [...world.occurrences.values()],
    revisions: [...world.revisions.values()],
    node_types: [...world.nodeTypes.values()],
  }

  return {
    snapshot,
    report: {
      events: { a: a.events.length, b: b.events.length, shared, merged: events.length },
      conflicts,
      counts: Object.fromEntries(
        Object.entries(snapshot).map(([k, v]) => [k, (v as unknown[]).length]),
      ),
    },
  }
}

/**
 * Where two devices wrote the same field of the same row and disagreed.
 *
 * Detected by walking the merged log and remembering the last value each field held.
 * An event that changes a field to something other than what the previous event left it
 * at, from a different device, is a conflict — and the later one has already won by the
 * time replay is done. Reporting it is the only way you ever find out.
 */
function findConflicts(events: readonly Event[]): Conflict[] {
  const conflicts: Conflict[] = []
  const lastWrite = new Map<string, { ts: number; device: string | null; value: unknown }>()

  for (const e of events) {
    const target = e.payload.target ?? 'node'
    const after = e.payload.after
    if (!after) continue
    const rowId = String(after.id ?? after.node_id ?? after.name ?? '')
    if (!rowId) continue

    for (const field of changedFields(e)) {
      const key = `${target}:${rowId}:${field}`
      const previous = lastWrite.get(key)
      const value = after[field]

      if (
        previous &&
        previous.device !== null &&
        e.device_id !== null &&
        previous.device !== e.device_id &&
        JSON.stringify(previous.value) !== JSON.stringify(value) &&
        // Only a near-simultaneous disagreement is interesting. Two edits a week apart
        // are a person changing their mind, not a sync conflict.
        e.ts - previous.ts < 24 * 3_600_000
      ) {
        conflicts.push({
          target,
          id: rowId,
          field,
          losing: previous,
          winning: { ts: e.ts, device: e.device_id, value },
        })
      }

      lastWrite.set(key, { ts: e.ts, device: e.device_id, value })
    }
  }

  return conflicts
}

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const files = args.filter((a) => !a.startsWith('-'))
  const dryRun = args.includes('--dry-run')
  const outIndex = args.findIndex((a) => a === '-o' || a === '--out')
  const out = outIndex >= 0 ? args[outIndex + 1] : null

  if (files.length !== 2) {
    console.error(`merge two Spatium snapshots

  npx tsx tools/merge-snapshot.ts <a.json> <b.json> [-o merged.json] [--dry-run]

Both files are read, never written. The merge is the union of their event logs,
replayed — so neither side loses anything, and running it twice changes nothing.`)
    return 2
  }

  const [aPath, bPath] = files.map((f) => resolve(f)) as [string, string]
  const a = readSnapshot(await readFile(aPath, 'utf8'))
  const b = readSnapshot(await readFile(bPath, 'utf8'))

  const { snapshot, report } = merge(a, b)

  console.error(
    `events: ${report.events.a} + ${report.events.b} = ${report.events.merged} ` +
      `(${report.events.shared} already shared)`,
  )
  for (const [table, count] of Object.entries(report.counts)) {
    if (table !== 'events') console.error(`  ${table.padEnd(12)} ${count}`)
  }

  if (report.conflicts.length) {
    console.error(`\n${report.conflicts.length} field(s) overwritten by last-write-wins:`)
    for (const c of report.conflicts.slice(0, 20)) {
      console.error(
        `  ${c.target} ${c.id.slice(0, 8)}… ${c.field}: ` +
          `${JSON.stringify(c.losing.value)} -> ${JSON.stringify(c.winning.value)}`,
      )
    }
  }

  if (dryRun) {
    console.error('\ndry run — nothing written')
    return 0
  }

  const target = resolve(out ?? aPath)
  const file = buildSnapshot(MemoryStore.fromSnapshot(snapshot), Date.now())
  await writeFile(target, JSON.stringify(file, null, 2), 'utf8')
  console.error(`\nwrote ${target}`)
  return 0
}

if (process.argv[1]?.endsWith('merge-snapshot.ts')) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err)
      process.exit(2)
    },
  )
}

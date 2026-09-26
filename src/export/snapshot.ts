/**
 * Full backup: .sqlite file + JSON snapshot. On a keyboard shortcut, from Phase 1 (§5.8).
 *
 * Backups matter more than the choice of storage engine. This is the actual insurance
 * for a lifelong personal archive — not IndexedDB durability guarantees. A browser can
 * evict origin storage under pressure and is entirely within its rights to; a file in
 * the Downloads folder cannot be evicted by anything except a person.
 *
 * TWO FORMATS, ON PURPOSE
 * -----------------------
 * The `.sqlite` is the fast, exact restore — same engine, same bytes, no parsing.
 * The `.json` is the one that will still be readable in fifteen years, by anything,
 * including by eye. A backup format that requires a working copy of the original
 * program is only half a backup, and this archive is meant to outlive several rewrites
 * of this app.
 *
 * The JSON includes the whole event log, which is the part that cannot be reconstructed
 * from anything else (§5.3).
 */

import { fmtDate } from '../core/time'
import type { DatabaseSnapshot, Store } from '../store/Store'
import { download } from './xlsx'

export interface SnapshotFile {
  format: 'spatium-temporis.snapshot'
  version: 1
  exported_at: number
  counts: Record<keyof DatabaseSnapshot, number>
  data: DatabaseSnapshot
}

export function buildSnapshot(store: Store, exportedAt = Date.now()): SnapshotFile {
  const data = store.snapshot()
  return {
    format: 'spatium-temporis.snapshot',
    version: 1,
    exported_at: exportedAt,
    /**
     * Counts at the top, before the data. A truncated or half-written file is the
     * failure mode that matters, and it is invisible in a JSON blob until you try to
     * restore it. A header that says "4,812 events" is checkable in one glance against
     * a file that contains 12.
     */
    counts: {
      nodes: data.nodes.length,
      spans: data.spans.length,
      edges: data.edges.length,
      events: data.events.length,
      recurrences: data.recurrences.length,
      occurrences: data.occurrences.length,
      revisions: data.revisions.length,
      node_types: data.node_types.length,
    },
    data,
  }
}

/** ⌘S. Writes the JSON always, and the `.sqlite` too when the backend has one. */
export function downloadSnapshot(store: Store, exportedAt = Date.now()): void {
  const stamp = fmtDate(exportedAt)
  const json = JSON.stringify(buildSnapshot(store, exportedAt), null, 2)
  download(new TextEncoder().encode(json), `spatium-${stamp}.json`, 'application/json')

  const bytes = store.exportBytes()
  if (bytes) download(bytes, `spatium-${stamp}.sqlite`, 'application/vnd.sqlite3')
}

/**
 * Validate a file before trusting it. Restoring a partial backup over a good database
 * is the one unrecoverable operation in this system, so the checks are deliberately
 * unfriendly: it either is a snapshot with matching counts, or it is refused.
 */
export function readSnapshot(text: string): DatabaseSnapshot {
  const parsed = JSON.parse(text) as Partial<SnapshotFile>
  if (parsed.format !== 'spatium-temporis.snapshot') {
    throw new Error('not a Spatium Temporis snapshot')
  }
  if (parsed.version !== 1) {
    throw new Error(`unknown snapshot version ${String(parsed.version)}`)
  }
  const data = parsed.data
  if (!data) throw new Error('snapshot has no data')

  for (const [key, expected] of Object.entries(parsed.counts ?? {})) {
    const actual = (data[key as keyof DatabaseSnapshot] ?? []).length
    if (actual !== expected) {
      throw new Error(`snapshot truncated: ${key} says ${expected}, file has ${actual}`)
    }
  }
  return data
}

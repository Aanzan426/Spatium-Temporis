/**
 * SQLite Store implementation.
 *
 * Browser/PWA: sql.js or wa-sqlite, persisted to IndexedDB/OPFS.
 * Later (Capacitor APK, Tauri desktop): the same SQL against a native SQLite file.
 * Only the *adapter* changes between those, not this file. That is the point (§7).
 *
 * TWO DESIGN CHOICES WORTH THE PARAGRAPH
 * --------------------------------------
 * **1. Reads come from an in-memory mirror, loaded once on open.**
 * Not a second source of truth: the mirror is *derived*, rebuilt from SQL on every
 * open, and never written to except through a mutation that has already been persisted.
 * The reason is the timeline — it re-queries the visible range on every pan frame, and
 * every query through wasm SQLite crosses the JS/wasm boundary and re-marshals rows. At
 * personal scale (thousands of nodes, not millions) the whole dataset is a few MB, so
 * the mirror costs nothing and buys a store that can be read synchronously inside a
 * render. If the data ever outgrows that, this is the one file that has to change.
 *
 * **2. Persistence is driven by the event log, not by the mutators.**
 * `persist()` receives the events a mutation appended and writes the rows out of their
 * `after` payloads. So a write that skipped the log would also skip the disk — §5.3
 * stops being a rule someone has to remember and becomes a property of the code. It
 * also proves the payloads are genuinely replayable (§5.4), continuously, because the
 * database is literally reconstructed from them on every single write.
 */

import type {
  Edge,
  Event,
  Millis,
  Node,
  NodeType,
  Occurrence,
  Recurrence,
  Revision,
  Span,
} from '../../core/types'
import { MemoryStore } from '../memory/MemoryStore'
import type { DatabaseSnapshot } from '../Store'
import type { SqlDatabase, SqlValue } from './driver'
import { transact } from './driver'

export class SqliteStore extends MemoryStore {
  private constructor(private db: SqlDatabase) {
    super()
  }

  /**
   * Migrate, load, and hand back a ready store.
   *
   * Synchronous by the time it returns a store: the async part (fetching the wasm,
   * reading the file) happens in the caller, which is why the adapter is injected
   * already-open. See the Store.ts header on why the interface is not promise-based.
   *
   * `migrationSql` is passed in rather than imported, for the same reason the driver
   * is: the browser gets it from Vite (`import sql from './migrations/001_init.sql?raw'`)
   * and a Node script reads the file off disk. A bundler-specific import here would
   * make this class unrunnable outside a Vite build — which would mean the SQL's first
   * execution ever was in a browser, by hand, instead of in `tools/store-check.ts`.
   */
  static open(db: SqlDatabase, migrationSql: string): SqliteStore {
    // Pragmas belong on the connection, not in the migration file: a pragma applies to
    // whichever connection happens to run it, so putting it in the .sql only works by
    // accident on first run.
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(migrationSql)

    const store = new SqliteStore(db)
    store.hydrate(store.readAll())
    return store
  }

  // -------------------------------------------------------------------------
  // load
  // -------------------------------------------------------------------------

  private readAll(): DatabaseSnapshot {
    const num = (v: SqlValue): number | null => (v === null ? null : Number(v))
    const str = (v: SqlValue): string | null => (v === null ? null : String(v))

    return {
      nodes: this.db.all<Record<string, SqlValue>>('SELECT * FROM nodes').map((r): Node => ({
        id: String(r.id),
        type: str(r.type!),
        title: String(r.title),
        body: str(r.body!),
        status: str(r.status!),
        magnitude: str(r.magnitude!) as Node['magnitude'],
        color: str(r.color!),
        attrs: JSON.parse(String(r.attrs ?? '{}')) as Record<string, unknown>,
        created_at: Number(r.created_at),
        updated_at: Number(r.updated_at),
      })),
      spans: this.db.all<Record<string, SqlValue>>('SELECT * FROM spans').map((r): Span => ({
        id: String(r.id),
        node_id: String(r.node_id),
        start_ms: num(r.start_ms!),
        start_precision: String(r.start_precision) as Span['start_precision'],
        end_ms: num(r.end_ms!),
        end_precision: String(r.end_precision) as Span['end_precision'],
      })),
      edges: this.db.all<Record<string, SqlValue>>('SELECT * FROM edges').map((r): Edge => ({
        id: String(r.id),
        from_node: String(r.from_node),
        to_node: String(r.to_node),
        relation: String(r.relation),
        created_at: Number(r.created_at),
      })),
      events: this.db
        .all<Record<string, SqlValue>>('SELECT * FROM events ORDER BY ts, id')
        .map((r): Event => ({
          id: String(r.id),
          ts: Number(r.ts),
          node_id: str(r.node_id!),
          kind: String(r.kind) as Event['kind'],
          payload: JSON.parse(String(r.payload ?? '{}')) as Event['payload'],
          device_id: str(r.device_id!),
          device_kind: str(r.device_kind!),
        })),
      recurrences: this.db
        .all<Record<string, SqlValue>>('SELECT * FROM recurrences')
        .map((r): Recurrence => ({
          id: String(r.id),
          node_id: String(r.node_id),
          kind: String(r.kind) as Recurrence['kind'],
          weekdays: r.weekdays === null ? null : (JSON.parse(String(r.weekdays)) as number[]),
          from_ms: Number(r.from_ms),
          until_ms: num(r.until_ms!),
          start_min: num(r.start_min!),
          end_min: num(r.end_min!),
        })),
      occurrences: this.db
        .all<Record<string, SqlValue>>('SELECT * FROM occurrences')
        .map((r): Occurrence => ({
          id: String(r.id),
          node_id: String(r.node_id),
          date_ms: Number(r.date_ms),
          start_ms: num(r.start_ms!),
          end_ms: num(r.end_ms!),
          outcome: str(r.outcome!) as Occurrence['outcome'],
          reason: str(r.reason!),
          follow_up_node_id: str(r.follow_up_node_id!),
          note: str(r.note!),
          created_at: Number(r.created_at),
          answered_at: num(r.answered_at!),
        })),
      revisions: this.db
        .all<Record<string, SqlValue>>('SELECT * FROM revisions')
        .map((r): Revision => ({
          id: String(r.id),
          scope: String(r.scope),
          ts: Number(r.ts),
          label: str(r.label!),
          // SQLite has no boolean. INTEGER 0/1 in, boolean out, in exactly one place.
          manual: Number(r.manual) === 1,
        })),
      node_types: this.db
        .all<Record<string, SqlValue>>('SELECT * FROM node_types')
        .map((r): NodeType => ({
          name: String(r.name),
          color: str(r.color!),
          sections: JSON.parse(String(r.sections ?? '[]')) as NodeType['sections'],
        })),
    }
  }

  // -------------------------------------------------------------------------
  // write
  // -------------------------------------------------------------------------

  /**
   * One transaction per mutation: the rows and the events that describe them land
   * together or not at all. State with no history is the one outcome §5.3 cannot
   * tolerate, and a crash mid-write is exactly how you would get it.
   */
  protected override persist(events: Event[]): void {
    if (!events.length) return
    transact(this.db, () => {
      for (const e of events) {
        this.writeTarget(e)
        this.db.run(
          'INSERT INTO events (id, ts, node_id, kind, payload, device_id, device_kind) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [e.id, e.ts, e.node_id, e.kind, JSON.stringify(e.payload), e.device_id, e.device_kind],
        )
      }
    })
  }

  /**
   * The mirror image of `applyOne` in `events.ts`: same dispatch, same semantics, one
   * writes a Map and one writes SQL. They are kept next to each other in review for
   * that reason — if a target is added to one and not the other, replay and the
   * database disagree, which is the single worst bug this codebase can have.
   */
  private writeTarget(e: Event): void {
    const { target, after, before } = e.payload
    switch (target) {
      case 'node': {
        if (!after) return
        const n = after as unknown as Node
        this.db.run(
          `INSERT INTO nodes (id, type, title, body, status, magnitude, color, attrs, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             type=excluded.type, title=excluded.title, body=excluded.body,
             status=excluded.status, magnitude=excluded.magnitude, color=excluded.color,
             attrs=excluded.attrs, updated_at=excluded.updated_at`,
          [n.id, n.type, n.title, n.body, n.status, n.magnitude, n.color,
           JSON.stringify(n.attrs ?? {}), n.created_at, n.updated_at],
        )
        return
      }
      case 'span': {
        if (after) {
          const s = after as unknown as Span
          this.db.run(
            `INSERT INTO spans (id, node_id, start_ms, start_precision, end_ms, end_precision)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               start_ms=excluded.start_ms, start_precision=excluded.start_precision,
               end_ms=excluded.end_ms, end_precision=excluded.end_precision`,
            [s.id, s.node_id, s.start_ms, s.start_precision, s.end_ms, s.end_precision],
          )
        } else if (before) {
          this.db.run('DELETE FROM spans WHERE id = ?', [String((before as unknown as Span).id)])
        }
        return
      }
      case 'edge': {
        if (after) {
          const g = after as unknown as Edge
          this.db.run(
            `INSERT INTO edges (id, from_node, to_node, relation, created_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
            [g.id, g.from_node, g.to_node, g.relation, g.created_at],
          )
        } else if (before) {
          // The only DELETE in the codebase. Unlinking removes a link, never a node —
          // nothing is deleted (§5.2), and the event keeps the link's whole history.
          this.db.run('DELETE FROM edges WHERE id = ?', [String((before as unknown as Edge).id)])
        }
        return
      }
      case 'recurrence': {
        if (after) {
          const r = after as unknown as Recurrence
          this.db.run(
            `INSERT INTO recurrences (id, node_id, kind, weekdays, from_ms, until_ms, start_min, end_min)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               kind=excluded.kind, weekdays=excluded.weekdays, from_ms=excluded.from_ms,
               until_ms=excluded.until_ms, start_min=excluded.start_min, end_min=excluded.end_min`,
            [r.id, r.node_id, r.kind, r.weekdays === null ? null : JSON.stringify(r.weekdays),
             r.from_ms, r.until_ms, r.start_min, r.end_min],
          )
        } else if (before) {
          this.db.run('DELETE FROM recurrences WHERE id = ?', [
            String((before as unknown as Recurrence).id),
          ])
        }
        return
      }
      case 'occurrence': {
        if (!after) return
        const o = after as unknown as Occurrence
        this.db.run(
          `INSERT INTO occurrences
             (id, node_id, date_ms, start_ms, end_ms, outcome, reason, follow_up_node_id, note, created_at, answered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             date_ms=excluded.date_ms, start_ms=excluded.start_ms, end_ms=excluded.end_ms,
             outcome=excluded.outcome, reason=excluded.reason,
             follow_up_node_id=excluded.follow_up_node_id, note=excluded.note,
             answered_at=excluded.answered_at`,
          [o.id, o.node_id, o.date_ms, o.start_ms, o.end_ms, o.outcome, o.reason,
           o.follow_up_node_id, o.note, o.created_at, o.answered_at],
        )
        return
      }
      case 'node_type': {
        if (!after) return
        const t = after as unknown as NodeType
        this.db.run(
          `INSERT INTO node_types (name, color, sections) VALUES (?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET color=excluded.color, sections=excluded.sections`,
          [t.name, t.color, JSON.stringify(t.sections ?? [])],
        )
        return
      }
      case 'revision': {
        if (!after) return
        const r = after as unknown as Revision
        this.db.run(
          `INSERT INTO revisions (id, scope, ts, label, manual) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET label=excluded.label, manual=excluded.manual`,
          [r.id, r.scope, r.ts, r.label, r.manual ? 1 : 0],
        )
        return
      }
      default:
        return
    }
  }

  // -------------------------------------------------------------------------

  /** The real `.sqlite` file, for §5.8. This is the half MemoryStore cannot give you. */
  override exportBytes(): Uint8Array | null {
    return this.db.serialize()
  }

  override close(): void {
    super.close()
    this.db.close()
  }

  /**
   * Re-read every table and compare against the mirror. Cheap, and it is the assertion
   * that the mirror in choice 1 above is genuinely derived rather than diverging.
   * `tools/store-check.ts` runs it; nothing in the app calls it.
   */
  verifyMirror(): string[] {
    const disk = this.readAll()
    const mine = this.snapshot()
    const problems: string[] = []
    const cmp = (name: keyof DatabaseSnapshot, key: (r: never) => string) => {
      const a = [...(disk[name] as unknown[])].map((r) => JSON.stringify(r, sortedKeys)).sort()
      const b = [...(mine[name] as unknown[])].map((r) => JSON.stringify(r, sortedKeys)).sort()
      if (a.length !== b.length) problems.push(`${name}: disk ${a.length}, memory ${b.length}`)
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] !== b[i]) problems.push(`${name}[${i}] differs:\n  disk   ${a[i]}\n  memory ${b[i]}`)
      }
      void key
    }
    cmp('nodes', (r: never) => r)
    cmp('spans', (r: never) => r)
    cmp('edges', (r: never) => r)
    cmp('events', (r: never) => r)
    cmp('recurrences', (r: never) => r)
    cmp('occurrences', (r: never) => r)
    cmp('revisions', (r: never) => r)
    cmp('node_types', (r: never) => r)
    return problems
  }
}

/** Stable key order, so two structurally equal rows stringify identically. */
function sortedKeys(this: unknown, _key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    )
  }
  return value
}

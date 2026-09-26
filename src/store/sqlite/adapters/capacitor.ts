/**
 * Capacitor SQLite adapter — the Android path (§7).
 *
 * A real SQLite file in the app's private storage, which is what makes the phone the
 * authoritative copy: it survives the app being killed, the WebView being reclaimed,
 * and the OS clearing web storage under pressure. None of those are true of OPFS.
 *
 * The plugin is INJECTED, like every other driver here — `src/` never imports a storage
 * package (Store.ts header). The call site, in `bootstrap.ts`:
 *
 *   import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
 *   const conn = new SQLiteConnection(CapacitorSQLite)
 *   const db = await conn.createConnection('spatium', false, 'no-encryption', 1, false)
 *   await db.open()
 *   const store = SqliteStore.open(capacitorAdapter(db), migration)
 *
 * THE ONE AWKWARD THING, AND WHY IT IS HANDLED HERE
 * -------------------------------------------------
 * The plugin's API is asynchronous and `SqlDatabase` is not — deliberately, because the
 * timeline re-queries while panning and `useSyncExternalStore` cannot await (Store.ts).
 * The two are reconciled by reading the whole database once, synchronously-from-the-
 * store's-point-of-view, at open, and treating writes as fire-and-forget against a
 * serialized queue.
 *
 * That is safe here for a specific reason rather than by hope: `SqliteStore` already
 * answers every read from its in-memory mirror and only ever *writes* through this
 * adapter. So a write that has not yet reached the disk is still visible to the app,
 * and the queue guarantees writes land in the order they were issued. What it gives up
 * is knowing the instant a write is durable — hence `flush()`, which the app awaits
 * before backgrounding and before taking a snapshot.
 */

import type { SqlDatabase, SqlParams, SqlValue } from '../driver'

/** The subset of `@capacitor-community/sqlite`'s connection this adapter touches. */
export interface CapacitorSQLiteConnection {
  execute(statements: string, transaction?: boolean): Promise<{ changes?: { changes?: number } }>
  run(
    statement: string,
    values?: SqlValue[],
    transaction?: boolean,
  ): Promise<{ changes?: { changes?: number } }>
  query(statement: string, values?: SqlValue[]): Promise<{ values?: Record<string, SqlValue>[] }>
  close(): Promise<void>
}

export interface CapacitorAdapter extends SqlDatabase {
  /** Resolves when every queued write has hit the disk. Await before a snapshot. */
  flush(): Promise<void>
  /** Anything a queued write threw. Checked by the app on resume; never swallowed. */
  errors(): readonly Error[]
}

/**
 * The rows every read needs, fetched once before the store opens. Passing them in
 * rather than fetching them lazily is what lets the synchronous interface hold.
 */
export type Preloaded = Record<string, Record<string, SqlValue>[]>

export function capacitorAdapter(
  conn: CapacitorSQLiteConnection,
  preloaded: Preloaded,
): CapacitorAdapter {
  /**
   * One promise chain, so writes land in issue order. Without it, two `run` calls race
   * and a row can be written before the row it references — which the foreign keys
   * would then reject, at random, under load.
   */
  let queue: Promise<void> = Promise.resolve()
  const errors: Error[] = []

  const enqueue = (work: () => Promise<unknown>): void => {
    queue = queue.then(
      () =>
        work().then(
          () => undefined,
          (err: unknown) => {
            // Never swallowed and never thrown into an unrelated call stack: collected,
            // and surfaced by the app on resume. A write that silently failed is the
            // one failure §5.3 cannot tolerate.
            errors.push(err instanceof Error ? err : new Error(String(err)))
          },
        ),
      () => undefined,
    )
  }

  return {
    exec(sql) {
      enqueue(() => conn.execute(sql, false))
    },
    run(sql, params) {
      enqueue(() => conn.run(sql, [...(params ?? [])], false))
    },
    all<T>(sql: string, _params?: SqlParams): T[] {
      /**
       * Reads come from the preload. `SqliteStore` only calls `all()` during `open()`
       * and `verifyMirror()`, and the statements are `SELECT * FROM <table>` — so the
       * table name is enough to answer them, and there is no query planning to do.
       *
       * A read this cannot answer is a programming error rather than a runtime
       * condition, so it throws loudly instead of returning an empty array, which would
       * look exactly like an empty database.
       */
      const table = /FROM\s+([a-z_]+)/i.exec(sql)?.[1]
      const rows = table ? preloaded[table] : undefined
      if (!rows) {
        throw new Error(
          `capacitorAdapter: no preloaded rows for "${sql}". ` +
            'Reads are served from the open-time preload; add the table to bootstrap.',
        )
      }
      return rows as unknown as T[]
    },
    /**
     * Null: the database is a file the OS owns, and the plugin exposes copy/export
     * rather than a byte buffer. §5.8's insurance on this platform is the JSON snapshot
     * plus that file — see `src/export/snapshot.ts`.
     */
    serialize() {
      return null
    },
    close() {
      enqueue(() => conn.close())
    },
    async flush() {
      await queue
    },
    errors() {
      return errors
    },
  }
}

/** The tables `SqliteStore.open()` reads. Kept here so bootstrap cannot forget one. */
export const PRELOAD_TABLES = [
  'nodes', 'spans', 'edges', 'events', 'recurrences', 'occurrences', 'revisions', 'node_types',
] as const

/** Fetch every table once, for the preload above. */
export async function preload(conn: CapacitorSQLiteConnection): Promise<Preloaded> {
  const out: Preloaded = {}
  for (const table of PRELOAD_TABLES) {
    const result = await conn.query(`SELECT * FROM ${table}`)
    out[table] = result.values ?? []
  }
  return out
}

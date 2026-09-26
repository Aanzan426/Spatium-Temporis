/**
 * The SQL driver seam, one level below the Store seam.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * `SqliteStore` must run against three different SQLite bindings over this project's
 * life — sql.js/wa-sqlite in the browser, the Capacitor plugin on Android, native
 * SQLite under Tauri (§7) — and against `node:sqlite` in scripts, which is how the SQL
 * in `001_init.sql` gets exercised without a browser. Those four have four different
 * APIs and none of them is a dependency of this app.
 *
 * So: the store talks to this four-method interface, and each binding gets a ten-line
 * adapter. Nothing in `src/` imports a SQLite package. That is also why the app can
 * typecheck and build today with no sql.js installed — the dependency is injected, not
 * imported.
 *
 * `adapters/` holds the concrete ones. They are the only files that know a vendor API.
 */

export type SqlValue = string | number | null | Uint8Array

/** Positional parameters only. Named parameters differ across every binding. */
export type SqlParams = readonly SqlValue[]

export interface SqlDatabase {
  /** Run one or more statements with no parameters and no result. Used for migrations. */
  exec(sql: string): void
  /** Run one parameterized statement, returning nothing. */
  run(sql: string, params?: SqlParams): void
  /** Run one parameterized query, returning every row as a plain object. */
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlParams): T[]
  /**
   * The database file's bytes, for §5.8's export. Null where the binding cannot produce
   * them (a native file-backed handle usually can't — the file itself is the export).
   */
  serialize(): Uint8Array | null
  close(): void
}

/**
 * Wrap a set of writes in one transaction.
 *
 * This is not an optimization, it is the durability guarantee that makes the event log
 * trustworthy: a row and the event describing it are written together or not at all.
 * A crash between the two would produce state with no history — exactly the failure
 * §5.3 exists to prevent.
 */
export function transact<T>(db: SqlDatabase, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/**
 * `node:sqlite` adapter — how the SQL in `001_init.sql` gets exercised without a browser.
 *
 * Node 22 ships SQLite in core (`node:sqlite`, no npm package, no build step), which
 * makes `tools/store-check.ts` possible: the real schema, the real statements and the
 * real `SqliteStore` running headless in a few hundred milliseconds. Without this, the
 * SQL layer's first execution would be in a browser, by hand, months from now.
 *
 * It is a *scripts* adapter. The app never imports it — `node:sqlite` does not exist in
 * a browser, and a stray import would break the Vite build.
 *
 * The structural types below avoid a compile-time dependency on `@types/node`'s
 * `node:sqlite` declarations, which are still marked experimental and move between
 * minor versions.
 */

import type { SqlDatabase, SqlParams, SqlValue } from '../driver'

interface NodeStatement {
  // `unknown` values, not `SqlValue`: node:sqlite's own output type includes bigint,
  // and a structural type that is narrower than the real one makes `DatabaseSync`
  // itself unassignable here. Narrowing happens at the call site, where the column is
  // known.
  all(...params: readonly SqlValue[]): Record<string, unknown>[]
  run(...params: readonly SqlValue[]): unknown
}

export interface NodeDatabaseSync {
  exec(sql: string): void
  prepare(sql: string): NodeStatement
  close(): void
}

export function nodeSqliteAdapter(db: NodeDatabaseSync): SqlDatabase {
  return {
    exec(sql) {
      db.exec(sql)
    },
    run(sql, params) {
      db.prepare(sql).run(...(params ?? []))
    },
    all<T>(sql: string, params?: SqlParams): T[] {
      return db.prepare(sql).all(...(params ?? [])) as T[]
    },
    /**
     * Null, not a throw: `node:sqlite` has no `serialize()`, and the file on disk is
     * already the export. §5.8's .sqlite half is satisfied by copying the file.
     */
    serialize() {
      return null
    },
    close() {
      db.close()
    },
  }
}

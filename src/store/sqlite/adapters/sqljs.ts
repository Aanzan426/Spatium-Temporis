/**
 * sql.js / wa-sqlite adapter — the browser and PWA path (§7).
 *
 * The sql.js module is INJECTED, never imported: `src/` must not depend on a storage
 * library (Store.ts header), and the wasm binary has to be fetched at runtime anyway.
 * Call site, in main.tsx or wherever the app boots:
 *
 *   import initSqlJs from 'sql.js'
 *   const SQL = await initSqlJs({ locateFile: (f) => `/sql-wasm/${f}` })
 *   const db = new SQL.Database(bytesFromOpfsOrUndefined)
 *   const store = SqliteStore.open(sqlJsAdapter(db))
 *
 * `npm i sql.js` and copy `node_modules/sql.js/dist/sql-wasm.wasm` into `public/`.
 * Nothing else in the codebase changes, which is the entire point of the seam.
 *
 * The structural types below are deliberately minimal — they describe only what this
 * adapter touches, so there is no `@types/sql.js` dependency and no version coupling.
 */

import type { SqlDatabase, SqlParams, SqlValue } from '../driver'

interface SqlJsStatement {
  bind(params: readonly SqlValue[]): boolean
  step(): boolean
  getAsObject(): Record<string, SqlValue>
  free(): boolean
}

export interface SqlJsDatabase {
  run(sql: string, params?: readonly SqlValue[]): unknown
  exec(sql: string): unknown
  prepare(sql: string): SqlJsStatement
  export(): Uint8Array
  close(): void
}

export function sqlJsAdapter(db: SqlJsDatabase): SqlDatabase {
  return {
    exec(sql) {
      db.exec(sql)
    },
    run(sql, params) {
      db.run(sql, params ?? [])
    },
    all<T>(sql: string, params?: SqlParams): T[] {
      const stmt = db.prepare(sql)
      try {
        if (params && params.length) stmt.bind(params)
        const rows: T[] = []
        // `step()` advances and returns false at the end. Forgetting `free()` leaks the
        // prepared statement inside the wasm heap, which is invisible until the tab
        // starts eating memory — hence the finally.
        while (stmt.step()) rows.push(stmt.getAsObject() as T)
        return rows
      } finally {
        stmt.free()
      }
    },
    serialize() {
      return db.export()
    },
    close() {
      db.close()
    },
  }
}

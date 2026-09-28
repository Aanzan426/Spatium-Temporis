/**
 * Boot. The one file that knows which platform this is.
 *
 * Everything above it — every page, the timeline, the store interface — is identical on
 * both. §7's "one codebase, packaged three ways" is a claim about exactly this file
 * being the only variable, and it is worth checking that stays true.
 *
 * THREE DECISIONS, AND NOTHING ELSE
 * ---------------------------------
 *   1. Which `Store` implementation — native SQLite on Android, memory on the web
 *      until sql.js is installed.
 *   2. Which alarm backend — Capacitor notifications, or the no-op.
 *   3. Which view — the phone's three tabs, or the desktop's two pages.
 *
 * WHY THE PLUGIN IMPORTS ARE STATIC
 * ---------------------------------
 * They used to be dynamic `import()`s behind a runtime check, "so the web bundle never
 * contains them". That reasoning broke the APK: a dynamic import of a bare specifier
 * (`import('@capacitor-community/sqlite')`) survives Vite's bundling untouched, and a
 * WebView has no node_modules to resolve it against. On the phone the import rejected
 * every single launch, the catch silently fell back to the MemoryStore, and the user's
 * data lived only in RAM — which is exactly the "clearing the cache wipes my data"
 * report that started this. Both packages are in `dependencies` now, so a web build
 * resolves and bundles them statically like any other module: they are registerPlugin
 * stubs there, harmless and never called because `isNative()` is false.
 *
 * That is also why this is async and `main.tsx` awaits it.
 */

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { LocalNotifications } from '@capacitor/local-notifications'
import { capacitorAlarms } from './alarms/capacitor-alarms'
import type { AlarmBackend } from './alarms/alarms'
import { noopAlarms } from './alarms/alarms'
import { deviceIdentity } from './core/device'
import { MemoryStore } from './store/memory/MemoryStore'
import { seed } from './store/memory/seed'
import { SqliteStore } from './store/sqlite/SqliteStore'
import { capacitorAdapter, preload } from './store/sqlite/adapters/capacitor'
import migration from './store/sqlite/migrations/001_init.sql?raw'
import type { Store } from './store/Store'

export interface Boot {
  store: Store
  alarms: AlarmBackend
  view: 'phone' | 'desktop'
  /** Awaited before snapshots and on background, where the backend queues writes. */
  flush: () => Promise<void>
  /**
   * How persistence came up, shown verbatim by the phone shell while the store is not
   * durable (BootStatus in `App.tsx`). A fallback the user cannot see is a fallback
   * that gets reported as "the app deletes my data" instead of "the app is broken".
   */
  diagnostic: string
}

export const isNative = (): boolean => 'Capacitor' in globalThis

export async function boot(): Promise<Boot> {
  const kind = deviceIdentity().kind

  if (isNative()) {
    try {
      return await bootNative()
    } catch (err) {
      /**
       * A native boot that fails must not leave a blank screen. It falls back to memory
       * and says so loudly — on screen, not only the console. It does NOT silently
       * pretend to persist: a user who believes their outcomes are being kept and is
       * wrong is worse off than one who knows the app is broken.
       */
      const message = err instanceof Error ? err.message : String(err)
      console.error('native boot failed, falling back to memory:', err)
      const store = new MemoryStore()
      seed(store)
      return {
        store,
        alarms: noopAlarms,
        view: 'phone',
        flush: async () => undefined,
        diagnostic: `NOT PERSISTING — native SQLite failed to load: ${message}`,
      }
    }
  }

  // Web. sql.js is not installed yet, so this is still memory-backed — the swap is
  // three lines here and nothing anywhere else (§7):
  //
  //   const SQL = await (await import('sql.js')).default({ locateFile: f => `/sql-wasm/${f}` })
  //   const db = new SQL.Database(await loadFromOpfs())
  //   const store = SqliteStore.open(sqlJsAdapter(db), migration)
  const store = new MemoryStore()
  seed(store)
  return {
    store,
    alarms: noopAlarms,
    view: kind === 'phone' ? 'phone' : 'desktop',
    flush: async () => undefined,
    diagnostic: 'web preview — memory-backed, not persisted yet (§7)',
  }
}

async function bootNative(): Promise<Boot> {
  const connection = new SQLiteConnection(CapacitorSQLite)
  const db = await connection.createConnection('spatium', false, 'no-encryption', 1, false)
  await db.open()

  // The migration runs before the preload, or the first launch reads tables that do
  // not exist yet.
  await db.execute(migration, false)

  const rows = await preload(db)
  const adapter = capacitorAdapter(db, rows)
  const store = SqliteStore.open(adapter, migration)

  // Freeze everything the rules imply up to yesterday. Idempotent, so it costs one pass
  // on every open and writes nothing the second time (§5.5).
  const yesterday = Date.now() - 24 * 3_600_000
  store.materializePast(yesterday)

  return {
    store,
    alarms: capacitorAlarms(LocalNotifications),
    view: 'phone',
    flush: () => adapter.flush(),
    diagnostic: 'persisting to on-device SQLite',
  }
}

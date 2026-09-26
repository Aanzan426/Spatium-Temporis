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
 * The plugins are loaded with dynamic `import()` behind a runtime check, so the web
 * bundle never contains them and a browser build does not need Capacitor installed at
 * all. That is also why this is async and `main.tsx` awaits it.
 */

import { capacitorAlarms } from './alarms/capacitor-alarms'
import type { AlarmBackend } from './alarms/alarms'
import { noopAlarms } from './alarms/alarms'
import { deviceIdentity } from './core/device'
import { MemoryStore } from './store/memory/MemoryStore'
import { seed } from './store/memory/seed'
import { SqliteStore } from './store/sqlite/SqliteStore'
import { capacitorAdapter, preload } from './store/sqlite/adapters/capacitor'
import type { CapacitorSQLiteConnection } from './store/sqlite/adapters/capacitor'
import type { LocalNotificationsPlugin } from './alarms/capacitor-alarms'
import migration from './store/sqlite/migrations/001_init.sql?raw'
import type { Store } from './store/Store'

export interface Boot {
  store: Store
  alarms: AlarmBackend
  view: 'phone' | 'desktop'
  /** Awaited before snapshots and on background, where the backend queues writes. */
  flush: () => Promise<void>
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
       * and says so loudly — but it does NOT silently pretend to persist, because a
       * user who believes their outcomes are being kept and is wrong is worse off than
       * one who knows the app is broken.
       */
      console.error('native boot failed, falling back to memory:', err)
      const store = new MemoryStore()
      seed(store)
      return { store, alarms: noopAlarms, view: 'phone', flush: async () => undefined }
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
  }
}

async function bootNative(): Promise<Boot> {
  // Specifier in a variable so Vite leaves it alone in the web build, where these
  // packages are not installed and a static import would fail the build outright.
  const sqlitePkg = '@capacitor-community/sqlite'
  const notificationsPkg = '@capacitor/local-notifications'

  /**
   * Typed against local structural interfaces, not the packages' own types.
   *
   * The packages are Android-only dependencies and are not installed for a web build,
   * so `typeof import('@capacitor-community/sqlite')` would fail the typecheck on any
   * machine that has not run the Android setup. The shapes below describe only what is
   * used here, which is also the complete list of what has to stay true if the plugin
   * changes.
   */
  const sqlite = (await import(/* @vite-ignore */ sqlitePkg)) as unknown as {
    CapacitorSQLite: unknown
    SQLiteConnection: new (plugin: unknown) => {
      createConnection(
        database: string,
        encrypted: boolean,
        mode: string,
        version: number,
        readonly: boolean,
      ): Promise<CapacitorSQLiteConnection & { open(): Promise<void>; execute(sql: string, tx?: boolean): Promise<unknown> }>
    }
  }
  const notifications = (await import(/* @vite-ignore */ notificationsPkg)) as unknown as {
    LocalNotifications: LocalNotificationsPlugin
  }

  const connection = new sqlite.SQLiteConnection(sqlite.CapacitorSQLite)
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
    alarms: capacitorAlarms(notifications.LocalNotifications),
    view: 'phone',
    flush: () => adapter.flush(),
  }
}

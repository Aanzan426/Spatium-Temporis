/**
 * The shell: two pages, one store, and the export shortcut.
 *
 * WHY THE STORE IS CREATED HERE
 * -----------------------------
 * Exactly one store exists, it is created once, and everything below reaches it through
 * context. Every page is a projection over the one store (§8) — a page that constructed
 * its own would be a second dataset wearing the same interface, which is the failure
 * §8 exists to prevent.
 *
 * `useState(() => …)` rather than `useMemo`: React may discard and re-run a memo, and
 * a store that gets rebuilt mid-session loses the event log. State initialisers are
 * guaranteed to run once.
 *
 * THE BOOT DIAGNOSTIC
 * -------------------
 * `bootstrap.ts` hands back not just a store but *how it came up*. When the store is
 * not durable — native SQLite failed and boot fell back to memory — that fact is shown
 * in red on every screen until it is fixed. It used to go to the console only, which
 * on a phone nobody is watching meant the app reported "the app deletes my data" for
 * weeks before anyone could name the cause. A fallback the user cannot see is a
 * fallback that gets filed as data loss.
 *
 * SWAPPING IN SQLITE IS A THREE-LINE CHANGE HERE AND NOWHERE ELSE (§7):
 *
 *   import initSqlJs from 'sql.js'
 *   import migration from './store/sqlite/migrations/001_init.sql?raw'
 *   const SQL = await initSqlJs({ locateFile: (f) => `/sql-wasm/${f}` })
 *   const store = SqliteStore.open(sqlJsAdapter(new SQL.Database(bytes)), migration)
 *
 * That is the whole promise of the Store seam, and it is worth checking it stays true
 * every time something is added below.
 */

import { useEffect, useState } from 'react'
import type { AlarmBackend } from './alarms/alarms'
import { reschedule } from './alarms/alarms'
import { downloadSnapshot } from './export/snapshot'
import { downloadWorkbook } from './export/xlsx'
import { MainPage } from './pages/main/MainPage'
import { SchedulerPage } from './pages/scheduler/SchedulerPage'
import { PhoneApp } from './pages/phone/PhoneApp'
import { StoreProvider } from './store/useStore'
import type { Store } from './store/Store'

type Page = 'main' | 'scheduler'

export interface AppProps {
  store: Store
  alarms: AlarmBackend
  /** Chosen in `bootstrap.ts`. The only place platform is decided. */
  view: 'phone' | 'desktop'
  /** How the store came up — from `boot()`. Shown verbatim while not durable. */
  diagnostic: string
}

/** Is this diagnostic the "all good" one from `bootNative()`? Defined once, here. */
const isPersisting = (diagnostic: string): boolean =>
  diagnostic === 'persisting to on-device SQLite'

/**
 * Shown while the store is not durable. Deliberately plain text, full width, red:
 * it must survive a glance and be unambiguous about what is and is not being saved.
 */
function BootStatus({ message }: { message: string }) {
  return (
    <div className="boot-status" role="alert">
      {message}
    </div>
  )
}

export function App({ store, alarms, view, diagnostic }: AppProps) {
  const [page, setPage] = useState<Page>('main')
  const [alarmsAvailable, setAlarmsAvailable] = useState(false)

  /**
   * The pending alarm set is stale by construction — it is scheduled ahead of time
   * against a plan that keeps changing. So it is rebuilt on every write, which the
   * store's own subscription gives for free, and once on open.
   */
  useEffect(() => {
    let cancelled = false
    const rebuild = () => {
      void reschedule(store, alarms).then((n) => {
        if (!cancelled) setAlarmsAvailable(n > 0)
      })
    }
    rebuild()
    const unsubscribe = store.subscribe(rebuild)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [store, alarms])

  if (view === 'phone') {
    return (
      <StoreProvider value={store}>
        {!isPersisting(diagnostic) && <BootStatus message={diagnostic} />}
        <PhoneApp alarmsAvailable={alarmsAvailable} diagnostic={diagnostic} />
      </StoreProvider>
    )
  }

  /**
   * Export on a shortcut, from Phase 1 (§5.8). Backups matter more than the choice of
   * storage engine — and a browser tab's storage can be evicted, which makes this the
   * actual insurance policy rather than a convenience.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void downloadSnapshot(store)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        void downloadWorkbook(store)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  return (
    <StoreProvider value={store}>
      {!isPersisting(diagnostic) && <BootStatus message={diagnostic} />}
      <nav className="nav">
        <img src="/logo-icon.svg" alt="" className="nav-logo" />
        <strong>Spatium Temporis</strong>
        <button className={page === 'main' ? 'on' : ''} onClick={() => setPage('main')}>
          Timeline
        </button>
        <button className={page === 'scheduler' ? 'on' : ''} onClick={() => setPage('scheduler')}>
          Scheduler
        </button>
        <span className="hint">press / to capture, ⌘S to save a snapshot, ⌘E for the workbook</span>
      </nav>
      {page === 'main' ? <MainPage /> : <SchedulerPage />}
    </StoreProvider>
  )
}

/**
 * The React binding for the Store. The only file that knows both React and the store
 * exist — pages get data through hooks, never by holding a store instance themselves.
 *
 * `useSyncExternalStore` rather than `useState` + manual re-render:
 * it is React's own answer to "an external mutable thing changed", it gets tearing
 * right under concurrent rendering, and it makes the subscription cost one line per
 * page instead of an effect and a counter per page.
 *
 * THE SELECTOR RULE THAT WILL BITE
 * --------------------------------
 * `getSnapshot` must return something referentially stable between changes. A selector
 * that builds an array — `() => store.listNodes()` — returns a new array every call, so
 * React sees a change on every render and loops forever. So: subscribe to the *version
 * number*, then derive the array in a `useMemo` keyed on it. That is what `useQuery`
 * below does, and it is why pages should use it rather than rolling their own.
 */

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import type { Store } from './Store'

const StoreContext = createContext<Store | null>(null)

export const StoreProvider = StoreContext.Provider

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore: no StoreProvider above this component')
  return store
}

/** The store's write counter. Changes on every mutation; stable otherwise. */
export function useStoreVersion(): number {
  const store = useStore()
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.version(),
    () => store.version(),
  )
}

/**
 * Run a query against the store and re-run it whenever anything is written.
 *
 * Deliberately coarse: any write invalidates every query. Fine-grained invalidation is
 * a real optimization and a real source of "why didn't this update" bugs, and at
 * personal scale re-running a filter over a few thousand rows is microseconds. Revisit
 * when a profiler says to, not before.
 */
export function useQuery<T>(select: (store: Store) => T, deps: unknown[] = []): T {
  const store = useStore()
  const version = useStoreVersion()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => select(store), [store, version, ...deps])
}

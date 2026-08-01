/**
 * THE ARCHITECTURAL SEAM.
 *
 * Every read and write in the app goes through this interface. Nothing above it ever
 * imports sqlite, IndexedDB, Capacitor or Tauri directly. That discipline is the entire
 * reason web -> PWA -> Android APK -> desktop is a swap instead of a rewrite (§7).
 *
 * If you find yourself importing a storage library inside src/pages or src/timeline,
 * something has gone wrong.
 *
 * Shape to define here:
 *   nodes:       get, list, create, update            (update also appends an event)
 *   spans:       get/set for a node
 *   edges:       list by node, link, unlink
 *   events:      append, range query, replayTo(ts)
 *   recurrence:  get/set, expand(range)
 *   occurrences: list(range), materialize(past), setOutcome   (outcome is Phase 2 UI)
 *   revisions:   list(scope), mark(label), stateAt(revisionId)
 *
 * Implementations: MemoryStore (now, fake data), SqliteStore (step 2).
 */
export {}

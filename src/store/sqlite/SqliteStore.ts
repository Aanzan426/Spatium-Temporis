/**
 * SQLite Store implementation.
 *
 * Browser/PWA: wa-sqlite or sql.js, persisted to IndexedDB/OPFS.
 * Later (Capacitor APK, Tauri desktop): the same SQL against a native SQLite file.
 * Only this file changes between those. That is the point (§7).
 *
 * Call navigator.storage.persist() on the web path so the OS doesn't evict the
 * database under storage pressure. Note that this matters far less than §5.8 — a
 * working export is the real insurance, not the storage backend.
 */
export {}

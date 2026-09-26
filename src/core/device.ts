/**
 * Which device wrote this.
 *
 * WHY IT IS A COLUMN AND NOT A NICE-TO-HAVE
 * -----------------------------------------
 * A union-and-replay merge does not strictly need it: events carry their own ids and
 * whole-row payloads, so the merge is correct without knowing where each event came
 * from. The field earns its place twice over anyway.
 *
 * The first time two devices disagree — a node retitled in two places within a minute,
 * a rule edited on the laptop and then again on the phone — the question is always
 * "which of these happened where", and without this field it is unanswerable. Not hard
 * to answer: unanswerable, permanently, because the information was never recorded.
 *
 * The second reason is the apprentice model (§11). "Captured on the phone at 23:40" and
 * "planned at the desk on a Sunday afternoon" are different acts by the same person,
 * and the difference is exactly the kind of thing the model exists to learn. Flattening
 * them into one undifferentiated stream throws away signal that cannot be recovered.
 *
 * It is one field, it is impossible to backfill, and it costs nothing now — the §5
 * category precisely.
 */

import { newId } from './ids'
import type { Id } from './types'

export type DeviceKind = 'phone' | 'desktop' | 'script' | 'unknown'

export interface DeviceIdentity {
  /** Stable per installation. A ULID, minted once and then persisted. */
  id: Id
  kind: DeviceKind
  /** Human-readable, for the times someone is reading the log by eye. */
  label: string
}

let current: DeviceIdentity | null = null

/**
 * The id is generated once per installation and kept, so it survives restarts. It is
 * deliberately NOT derived from anything about the hardware — no fingerprinting, no
 * user agent parsing. A random id in local storage answers "same device or not", which
 * is the entire question being asked.
 */
export function deviceIdentity(): DeviceIdentity {
  if (current) return current
  current = load()
  return current
}

/** For scripts and tests, which have no storage and want to say so explicitly. */
export function setDeviceIdentity(identity: DeviceIdentity): void {
  current = identity
}

const STORAGE_KEY = 'spatium.device'

function load(): DeviceIdentity {
  const kind = detectKind()
  const fallback = (): DeviceIdentity => ({ id: newId(), kind, label: defaultLabel(kind) })

  // `globalThis.localStorage` rather than a bare reference: this module is imported by
  // Node scripts, where it does not exist at all.
  const storage = (globalThis as { localStorage?: Storage }).localStorage
  if (!storage) return fallback()

  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DeviceIdentity>
      if (parsed.id) {
        return { id: parsed.id, kind: parsed.kind ?? kind, label: parsed.label ?? defaultLabel(kind) }
      }
    }
    const fresh = fallback()
    storage.setItem(STORAGE_KEY, JSON.stringify(fresh))
    return fresh
  } catch {
    // Private browsing, a full quota, a hostile embedder — all of which make storage
    // throw rather than return null. A per-session identity is still better than none.
    return fallback()
  }
}

function detectKind(): DeviceKind {
  const nav = (globalThis as { navigator?: Navigator }).navigator
  if (!nav) return 'script'
  // Coarse on purpose. The only decision downstream is which view to open and how to
  // label a row in a merge; neither needs to know the model of the handset.
  const isNative = 'Capacitor' in globalThis
  const touch = nav.maxTouchPoints > 0
  const narrow = (globalThis as { innerWidth?: number }).innerWidth
  if (isNative) return 'phone'
  if (touch && typeof narrow === 'number' && narrow < 900) return 'phone'
  return 'desktop'
}

const defaultLabel = (kind: DeviceKind): string =>
  kind === 'phone' ? 'phone' : kind === 'desktop' ? 'desktop' : kind

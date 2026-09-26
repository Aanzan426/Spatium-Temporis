/**
 * The end-of-block alarm (§9). Infrastructure, not convenience.
 *
 *   Nobody fills in a week of outcomes on Sunday honestly. They reconstruct, and
 *   reconstruction is fiction — which would poison the single most valuable training
 *   signal in the project.
 *
 * A prompt fired the moment a block ends, answered in two seconds, is the difference
 * between a real adherence record and an invented one.
 *
 * WHY SCHEDULING IS AHEAD-OF-TIME AND NOT A TIMER
 * -----------------------------------------------
 * There is no daemon on Android. Nothing of this app is running when the phone is in a
 * pocket, so an in-process timer fires only while the app is open, which is precisely
 * when it is least needed. Instead the OS is handed a list of future instants and does
 * the waiting: notifications fire whether or not the app exists in memory.
 *
 * The cost is that the schedule is ahead-of-time and therefore stale by construction.
 * It has to be rebuilt whenever anything it was derived from changes — a rule edited, a
 * block moved, an outcome recorded — and there is a cap on how many can be pending. So:
 * a horizon, a rebuild on every relevant write, and a reconcile on every app open.
 *
 * WHAT IS SCHEDULED IS A PROJECTION
 * ---------------------------------
 * Future occurrences are generated, never stored (§5.5), so an alarm points at a
 * `(node_id, date_ms)` pair rather than at a row. When an answer comes back, the block
 * is materialized first — `pinProjection` exists for exactly this — and only then does
 * the outcome get written.
 */

import { localMidnight, now } from '../core/time'
import type { Block, Id, Millis, Outcome } from '../core/types'
import { isProjected } from '../core/types'
import type { Store } from '../store/Store'

/** How far ahead to schedule. Beyond this, the app reschedules on next open. */
export const HORIZON_DAYS = 3

/**
 * Android caps pending alarms (500 on most versions) and each one costs the OS
 * something. Three days of blocks is well inside that even with an hourly rule.
 */
export const MAX_PENDING = 64

export interface PlannedAlarm {
  /** Stable across rebuilds, so rescheduling replaces rather than duplicates. */
  key: string
  nodeId: Id
  dateMs: Millis
  /** When it fires: the block's end (§9). */
  at: Millis
  title: string
  body: string
}

/**
 * The scheduling backend. Injected, like every other platform dependency here — the web
 * build has no notifications and must not import a plugin that assumes it does.
 */
export interface AlarmBackend {
  /** Replace the entire pending set. Idempotent by design; see the header on staleness. */
  schedule(alarms: readonly PlannedAlarm[]): Promise<void>
  cancelAll(): Promise<void>
  /** True once the user has granted notification permission. */
  available(): Promise<boolean>
}

/**
 * Which blocks deserve an alarm.
 *
 * Only blocks that have ended-or-will-end and have no outcome yet. An already-answered
 * block must not fire again: a second prompt for something already closed teaches you
 * to dismiss the notification without reading it, which destroys the whole mechanism
 * more thoroughly than missing one would.
 */
export function planAlarms(store: Store, fromMs = now()): PlannedAlarm[] {
  const from = localMidnight(fromMs)
  const to = from + HORIZON_DAYS * 24 * 3_600_000
  const blocks = store.blocksInRange(from, to)

  const planned: PlannedAlarm[] = []
  for (const block of blocks) {
    if (block.end_ms === null) continue
    if (block.end_ms < fromMs) continue // already past; the catch-up list handles these
    if (!isProjected(block) && block.outcome !== null) continue // already answered

    const node = store.getNode(block.node_id)
    planned.push({
      key: `${block.node_id}:${block.date_ms}`,
      nodeId: block.node_id,
      dateMs: block.date_ms,
      at: block.end_ms,
      title: node?.title ?? 'Block ended',
      // Two words and a time. The prompt has to be answerable without reading it
      // properly, or it will not be answered in two seconds.
      body: 'How did it go?',
    })
  }

  return planned.sort((a, b) => a.at - b.at).slice(0, MAX_PENDING)
}

/**
 * Blocks whose end has passed with no outcome recorded.
 *
 * This is the mechanism; notifications are a delivery detail on top of it. A missed
 * alarm, a phone that was off, a dismissed notification — none of them lose data,
 * because the question "what is outstanding?" is answered from the database every time
 * rather than from anything that had to stay running.
 */
export function outstanding(store: Store, fromMs = now(), lookbackDays = 7): Block[] {
  const from = localMidnight(fromMs) - lookbackDays * 24 * 3_600_000
  return store
    .blocksInRange(from, fromMs)
    .filter((b) => b.end_ms !== null && b.end_ms <= fromMs)
    .filter((b) => isProjected(b) || b.outcome === null)
    .sort((a, b) => (b.end_ms ?? 0) - (a.end_ms ?? 0))
}

/**
 * Record an answer against a block that may only be a projection.
 *
 * Materialize first (§5.5 — the past is rows, the future is generated), then write the
 * outcome. `pinProjection` is idempotent and `setOutcome` stamps `answered_at` itself,
 * so a double-tap costs nothing and cannot forge a prompter answer than really happened.
 */
export function recordOutcome(
  store: Store,
  block: Block,
  outcome: Outcome,
  extra?: { reason?: string; note?: string; followUpTitle?: string },
): void {
  const occurrence = isProjected(block)
    ? store.pinProjection(block.node_id, block.date_ms)
    : block

  let followUpId: Id | null = null

  /**
   * "What now" creates a NODE, not a text field (§9).
   *
   * A real node with an edge back to the occurrence that failed is what yields causal
   * chains — *when this gets missed, this is what happens next* — which is a far
   * stronger training target than prose, and it is precisely the work the graph exists
   * to do.
   */
  if (extra?.followUpTitle?.trim()) {
    const followUp = store.createNode({ title: extra.followUpTitle.trim() })
    store.link(followUp.id, occurrence.node_id, 'follows')
    followUpId = followUp.id
  }

  store.setOutcome(occurrence.id, outcome, {
    reason: extra?.reason?.trim() || null,
    note: extra?.note?.trim() || null,
    follow_up_node_id: followUpId,
  })
}

/**
 * Rebuild the pending set. Call on open, on resume, and after any write that could
 * change what is coming — which in practice means subscribing to the store.
 */
export async function reschedule(store: Store, backend: AlarmBackend): Promise<number> {
  if (!(await backend.available())) return 0
  const alarms = planAlarms(store)
  await backend.schedule(alarms)
  return alarms.length
}

/** A backend for the web build, where there is nothing to schedule against. */
export const noopAlarms: AlarmBackend = {
  schedule: async () => undefined,
  cancelAll: async () => undefined,
  // False, not true-with-no-effect: the today view uses this to decide whether to tell
  // the user their outcomes depend on opening the app.
  available: async () => false,
}

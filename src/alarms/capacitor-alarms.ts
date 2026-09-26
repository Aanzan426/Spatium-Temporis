/**
 * The Android notification backend for `alarms.ts`.
 *
 * Injected rather than imported, so the web bundle never pulls in a plugin that assumes
 * a native shell. `bootstrap.ts` wires this one up when it detects Capacitor and falls
 * back to `noopAlarms` otherwise.
 *
 * TWO ANDROID FACTS THAT WILL COST A DAY IF THEY ARE A SURPRISE
 * -------------------------------------------------------------
 * **Doze.** A notification scheduled the ordinary way is batched into whatever
 * maintenance window the OS feels like, which on a phone left alone overnight can be
 * hours. `allowWhileIdle` is what makes it fire at the instant asked for, and the whole
 * argument for the alarm (§9) collapses without it — a prompt that arrives forty
 * minutes late is asking you to reconstruct, which is the thing it exists to prevent.
 *
 * **Exact alarms need permission on Android 12+.** `SCHEDULE_EXACT_ALARM` is declared
 * in the manifest, and on 13+ the user is asked. If it is refused the alarms still
 * work, just imprecisely — so the answer is to record when the outcome was actually
 * given (`answered_at`) rather than to pretend, and to tell the user plainly in the
 * today view.
 *
 * Notification IDs are derived from the alarm key rather than counted, so rescheduling
 * replaces an entry instead of stacking a second copy of it.
 */

import type { AlarmBackend, PlannedAlarm } from './alarms'

/** The subset of `@capacitor/local-notifications` this backend touches. */
export interface LocalNotificationsPlugin {
  requestPermissions(): Promise<{ display: string }>
  checkPermissions(): Promise<{ display: string }>
  schedule(options: { notifications: NativeNotification[] }): Promise<unknown>
  getPending(): Promise<{ notifications: { id: number }[] }>
  cancel(options: { notifications: { id: number }[] }): Promise<unknown>
  registerActionTypes(options: { types: ActionType[] }): Promise<unknown>
}

interface ActionType {
  id: string
  actions: { id: string; title: string; input?: boolean }[]
}

interface NativeNotification {
  id: number
  title: string
  body: string
  schedule: { at: Date; allowWhileIdle: boolean }
  actionTypeId: string
  extra: Record<string, unknown>
}

/**
 * The one-tap answer, on the notification itself.
 *
 * `done` closes it with a single tap and no app launch — which is the two seconds §9
 * asks for. The other three open the app, because a miss needs the two follow-ups
 * (*why*, and *what now*) and "what now" creates a node.
 */
export const OUTCOME_ACTIONS: ActionType = {
  id: 'spatium.outcome',
  actions: [
    { id: 'done', title: 'Done' },
    { id: 'partial', title: 'Partly' },
    { id: 'skipped', title: 'Missed' },
  ],
}

export function capacitorAlarms(plugin: LocalNotificationsPlugin): AlarmBackend {
  let registered = false

  return {
    async available() {
      try {
        const current = await plugin.checkPermissions()
        if (current.display === 'granted') return true
        const asked = await plugin.requestPermissions()
        return asked.display === 'granted'
      } catch {
        return false
      }
    },

    async schedule(alarms: readonly PlannedAlarm[]) {
      if (!registered) {
        await plugin.registerActionTypes({ types: [OUTCOME_ACTIONS] })
        registered = true
      }

      // Replace rather than add. The planned set is rebuilt from the store on every
      // relevant write, so anything already pending is by definition stale.
      await this.cancelAll()

      await plugin.schedule({
        notifications: alarms.map((alarm) => ({
          id: notificationId(alarm.key),
          title: alarm.title,
          body: alarm.body,
          schedule: { at: new Date(alarm.at), allowWhileIdle: true },
          actionTypeId: OUTCOME_ACTIONS.id,
          // Carried through the notification so the handler can find the block without
          // guessing from the title — two blocks can share one.
          extra: { nodeId: alarm.nodeId, dateMs: alarm.dateMs },
        })),
      })
    },

    async cancelAll() {
      const pending = await plugin.getPending()
      if (pending.notifications.length) {
        await plugin.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) })
      }
    },
  }
}

/**
 * A stable 31-bit id from the alarm key. Android notification ids are signed 32-bit
 * ints, so a ULID cannot be one directly; hashing keeps rescheduling idempotent.
 */
function notificationId(key: string): number {
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash | 0) % 2_147_483_647
}

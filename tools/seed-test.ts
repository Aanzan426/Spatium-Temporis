/**
 * Test seed data for verification scripts.
 *
 * This is ONLY imported by store-check.ts and similar verification tools.
 * It is NOT used by the app in production - the production seed.ts is empty.
 *
 * This seed creates realistic test data to exercise:
 * - All five magnitudes (micro through tera)
 * - All precisions (exact through someday)
 * - Recurrence rules (daily, weekly)
 * - The frozen past rule (§5.5)
 * - Merge scenarios (two devices)
 */

import { addDays, addMonths, addYears, localMidnight, now } from '../src/core/time'
import type { Store } from '../src/store/Store'

export function seed(store: Store): void {
  if (store.listNodes().length > 0) return

  const today = localMidnight(now())
  const hour = 3_600_000

  // Create node types
  for (const t of [
    { name: 'work', color: '#7aa2f7' },
    { name: 'health', color: '#9ece6a' },
    { name: 'reading', color: '#e0af68' },
    { name: 'study', color: '#bb9af7' },
    { name: 'long-shot', color: '#f7768e' },
  ]) {
    store.upsertNodeType({ name: t.name, color: t.color, sections: [] })
  }

  // --- micro / kilo: this week ---------------------------------------------
  store.createNode(
    { title: 'Write read.ts', type: 'work', magnitude: 'kilo', color: '#7aa2f7' },
    {
      start_ms: today + 10 * hour,
      start_precision: 'exact',
      end_ms: today + 13 * hour,
      end_precision: 'exact',
    },
  )
  store.createNode(
    { title: 'Dentist', type: 'health', magnitude: 'micro', color: '#9ece6a' },
    {
      start_ms: addDays(today, 2) + 9.5 * hour,
      start_precision: 'exact',
      end_ms: addDays(today, 2) + 10.5 * hour,
      end_precision: 'exact',
    },
  )
  store.createNode(
    { title: 'Finish normalize.ts', type: 'work', magnitude: 'kilo', color: '#7aa2f7' },
    {
      start_ms: addDays(today, -3),
      start_precision: 'day',
      end_ms: addDays(today, 4),
      end_precision: 'day',
    },
  )

  // --- mega: this season ----------------------------------------------------
  store.createNode(
    { title: 'Phase 1 complete', type: 'work', magnitude: 'mega', color: '#7aa2f7' },
    {
      start_ms: addMonths(today, -1),
      start_precision: 'week',
      end_ms: addMonths(today, 3),
      end_precision: 'month',
    },
  )
  store.createNode(
    { title: 'Read: The Timeless Way of Building', type: 'reading', magnitude: 'kilo', color: '#e0af68' },
    {
      start_ms: addDays(today, -10),
      start_precision: 'week',
      end_ms: addMonths(today, 1),
      end_precision: 'month',
    },
  )

  // --- giga / tera: the fog -------------------------------------------------
  store.createNode(
    { title: 'Quant role', type: 'study', magnitude: 'giga', color: '#bb9af7' },
    {
      start_ms: addYears(today, 1),
      start_precision: 'quarter',
      end_ms: addYears(today, 2),
      end_precision: 'year',
    },
  )
  store.createNode(
    { title: 'Postgrad, somewhere', type: 'study', magnitude: 'tera', color: '#bb9af7' },
    {
      start_ms: addYears(today, 2),
      start_precision: 'year',
      end_ms: addYears(today, 6),
      end_precision: 'decade',
    },
  )
  store.createNode(
    { title: 'The apprentice model', type: 'long-shot', magnitude: 'tera', color: '#f7768e' },
    {
      start_ms: addYears(today, 3),
      start_precision: 'someday',
      end_ms: addYears(today, 9),
      end_precision: 'someday',
    },
  )

  // --- abandoned: dims, does not disappear (§5.2) ---------------------------
  const dropped = store.createNode(
    { title: 'Rewrite it in Rust', type: 'long-shot', magnitude: 'mega', color: '#f7768e' },
    {
      start_ms: addMonths(today, -2),
      start_precision: 'month',
      end_ms: addMonths(today, 2),
      end_precision: 'quarter',
    },
  )
  store.updateNode(dropped.id, { status: 'abandoned' })

  // --- the scheduler's framework -------------------------------------------
  const gym = store.createNode({ title: 'Gym', type: 'health', magnitude: 'kilo', color: '#9ece6a' })
  store.setRecurrence(gym.id, {
    kind: 'weekly',
    weekdays: [1, 3, 5],
    from_ms: addMonths(today, -2),
    start_min: 6 * 60,
    end_min: 7 * 60 + 30,
  })

  const deep = store.createNode({
    title: 'Deep work: Spatium',
    type: 'work',
    magnitude: 'kilo',
    color: '#7aa2f7',
  })
  store.setRecurrence(deep.id, {
    kind: 'weekly',
    weekdays: [1, 2, 3, 4, 5],
    from_ms: addMonths(today, -2),
    start_min: 9 * 60,
    end_min: 12 * 60,
  })

  // Freeze everything up to yesterday into real rows, then open a revision window
  store.materializePast(addDays(today, -1))
  store.markRevision('scheduler', 'baseline', true)
}

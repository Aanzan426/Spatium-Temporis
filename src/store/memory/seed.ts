/**
 * Seed data for development/demo only.
 *
 * This is DISABLED by default. To enable fake data for testing, uncomment
 * the call in bootstrap.ts.
 *
 * Nothing in the app depends on this file.
 */

import { addDays, addMonths, addYears, localMidnight, now } from '../../core/time'
import type { Store } from '../Store'

export function seed(store: Store): void {
  // Intentionally left empty - no pre-populated tasks.
  // The app starts clean. To add demo data for testing, uncomment this:
  //
  // if (store.listNodes().length > 0) return
  //
  // const today = localMidnight(now())
  // const hour = 3_600_000
  //
  // // ... rest of original seed code
}


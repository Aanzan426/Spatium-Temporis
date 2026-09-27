/**
 * Production seed - DISABLED.
 *
 * The app starts clean with no pre-populated data.
 * For test data, use `seed-test.ts` which is only imported by verification scripts.
 *
 * Nothing in the app depends on this file in production.
 */

import type { Store } from '../Store'
export function seed(store: Store): void {
  // Intentionally empty - no pre-populated tasks in production.
  // Test data is in tools/seed-test.ts, imported only by store-check.ts
}


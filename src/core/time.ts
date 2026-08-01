/**
 * Every time helper in the project. Nothing else does date arithmetic.
 *
 * Rules (§5.7):
 *   - Store UTC epoch ms. Render local. Never hand-roll `+ 86400000`.
 *   - Use date-fns. DST and variable month lengths will eat a weekend otherwise.
 *
 * The one that will bite: an occurrence's `date_ms` is LOCAL MIDNIGHT of the day it
 * belongs to, not the UTC instant of its start time. Get this wrong and a 6am session
 * lands on the wrong day twice a year, looking exactly like random corruption.
 */
export {}

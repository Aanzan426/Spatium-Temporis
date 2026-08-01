/**
 * Tick generation, culled to the viewport.
 *
 * Compute the FIRST VISIBLE tick and step forward. Never iterate every day between
 * 1900 and 2100 — that freezes the app the moment you zoom out, and it is the single
 * most common way this kind of view dies (§6).
 *
 * Stepping is calendar-aware, not arithmetic: months have different lengths and days
 * have different durations across DST. Use date-fns, via src/core/time.ts.
 */
export {}

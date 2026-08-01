/**
 * Zoom bands. A band is one row of data, not a view:
 *
 *   { minScale, maxScale, tickGenerator, labelFormat }
 *
 * WHICH BAND IS ACTIVE IS DERIVED FROM `scale` — never a mode that gets switched.
 * Adding centuries later is adding a row. Adding seconds is adding a row. No new
 * rendering code, ever.
 *
 * Bands cross-fade on opacity across their overlap so zoom feels continuous rather
 * than snapping.
 *
 * Phase 1 registers exactly four: day, week, month, year. Hours and decades/centuries
 * are deliberately unregistered until the mechanism is proven (§6).
 */
export {}

/**
 * THE CAMERA IS TWO NUMBERS. Nothing else.
 *
 *   scale    pixels per millisecond
 *   tOrigin  the instant at x = 0
 *
 *   x(t) = (t - tOrigin) * scale
 *   t(x) = tOrigin + x / scale
 *
 * Zooming changes one float. Panning changes the other. Every tick, label, bar and
 * hit-test derives from these two. If a third piece of camera state appears — a "mode",
 * a "current view", a "zoom level" enum — something has gone wrong and the eight-views
 * problem is creeping back in (§6).
 *
 * Zoom about the cursor: keep t(cursorX) fixed while changing scale, then solve for the
 * new tOrigin. That is what makes zoom feel right instead of lurching.
 */
export {}

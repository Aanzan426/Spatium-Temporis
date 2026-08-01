/**
 * The canvas the timeline draws into. Page-agnostic — the main page and the scheduler
 * both build on it (the scheduler is this, folded on a period, §8).
 *
 * Canvas 2D, not SVG and not DOM: thousands of ticks and bars will not survive DOM
 * nodes.
 *
 * Set up devicePixelRatio scaling immediately — size the backing store to
 * width * dpr and scale the context. Skip it and everything looks slightly blurry and
 * you lose an hour assuming it's your drawing code.
 *
 * STEP 1 STOPS HERE. Five hardcoded spans, drag to pan, ctrl-scroll to zoom, bars
 * welded to their real dates at every scale, tick labels changing format as you cross
 * day -> week -> month. No store, no state library, no styling system, no inbox.
 */
export function TimelineCanvas() {
  return <canvas />
}

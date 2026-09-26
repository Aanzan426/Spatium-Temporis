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
 * Every function here is pure and returns a new camera. That is what makes the camera
 * safe to hold in React state and trivial to animate or undo later.
 */

import { DAY_MS, DECADE_MS, HOUR_MS, YEAR_MS } from '../core/time'
import type { Millis } from '../core/types'

export interface Camera {
  /** Pixels per millisecond. Always > 0. */
  scale: number
  /** The instant at x = 0. */
  tOrigin: Millis
}

/**
 * Limits, expressed as "how wide is one unit on screen" rather than as raw floats,
 * because that is the only form in which they are checkable by eye.
 *
 * MAX: an hour ~1200px wide — enough to place a block to the minute, well past which
 * there is nothing left to see.
 * MIN: a decade ~40px wide — about two centuries across a laptop, which is the outer
 * edge of "a life" plus room to be wrong about it.
 */
export const MAX_SCALE = 1200 / HOUR_MS
export const MIN_SCALE = 40 / DECADE_MS

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

export const xOf = (cam: Camera, t: Millis): number => (t - cam.tOrigin) * cam.scale
export const tOf = (cam: Camera, x: number): Millis => cam.tOrigin + x / cam.scale

/** The time range currently visible in a viewport `width` pixels wide. */
export const visibleRange = (cam: Camera, width: number): [Millis, Millis] =>
  [cam.tOrigin, tOf(cam, width)]

/** Pan by a pixel delta. Dragging right moves the camera back in time. */
export const panBy = (cam: Camera, dxPixels: number): Camera => ({
  ...cam,
  tOrigin: cam.tOrigin - dxPixels / cam.scale,
})

/**
 * Zoom about the cursor: keep `t(cursorX)` fixed while changing scale, then solve for
 * the new origin.
 *
 *   t_anchor = tOrigin + cursorX / scale        (before)
 *   t_anchor = tOrigin' + cursorX / scale'      (after, must be equal)
 *   => tOrigin' = t_anchor - cursorX / scale'
 *
 * This is what makes zoom feel right instead of lurching. Zooming about the viewport
 * centre instead — the tempting simplification — makes the thing under the pointer slide
 * away, and no amount of easing fixes it.
 */
export function zoomAbout(cam: Camera, cursorX: number, factor: number): Camera {
  const scale = clampScale(cam.scale * factor)
  if (scale === cam.scale) return cam
  const anchor = tOf(cam, cursorX)
  return { scale, tOrigin: anchor - cursorX / scale }
}

/** Zoom keeping a given instant pinned wherever it currently sits. */
export const zoomAboutTime = (cam: Camera, t: Millis, factor: number): Camera =>
  zoomAbout(cam, xOf(cam, t), factor)

/**
 * Frame a time range in a viewport, with margin. Any hardcoded starting scale is wrong
 * for some dataset — too far in and the content is off-screen, too far out and it is a
 * speck.
 */
export function fitRange(
  from: Millis,
  to: Millis,
  width: number,
  marginFraction = 0.08,
): Camera {
  const span = Math.max(to - from, HOUR_MS)
  const usable = Math.max(width * (1 - 2 * marginFraction), 1)
  const scale = clampScale(usable / span)
  const margin = width * marginFraction
  return { scale, tOrigin: from - margin / scale }
}

/** A sensible opening view: a week either side of now. */
export function defaultCamera(width: number, nowMs: Millis): Camera {
  return fitRange(nowMs - 7 * DAY_MS, nowMs + 7 * DAY_MS, Math.max(width, 1))
}

/** Human-readable current zoom, for a status line. Nothing derives behaviour from it. */
export function describeScale(scale: number): string {
  const dayPx = DAY_MS * scale
  if (dayPx > 120) return `${Math.round(HOUR_MS * scale)} px/hour`
  if (dayPx > 2) return `${Math.round(dayPx)} px/day`
  const yearPx = YEAR_MS * scale
  return yearPx > 8 ? `${Math.round(yearPx)} px/year` : `${Math.round(DECADE_MS * scale)} px/decade`
}

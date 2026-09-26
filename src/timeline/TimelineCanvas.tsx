/**
 * The canvas the timeline draws into. Page-agnostic — the main page and the scheduler
 * both build on it (the scheduler is this, folded on a period, §8).
 *
 * Canvas 2D, not SVG and not DOM: thousands of ticks and bars will not survive DOM
 * nodes.
 *
 * devicePixelRatio scaling is set up on the first line of every resize — size the
 * backing store to width * dpr and scale the context. Skip it and everything looks
 * slightly blurry and you lose an hour assuming it's your drawing code.
 *
 * WHAT THIS COMPONENT OWNS, AND WHAT IT REFUSES TO
 * ------------------------------------------------
 * It owns pixels and pointer gestures. It does not own the camera (the page does, so
 * two views can share one) and it does not know the store exists — it is handed an
 * array of bars. That is what lets the scheduler reuse it without inheriting the main
 * page's queries, and it is why `DayLanes` can re-derive the same hit-test in DOM.
 *
 * React draws nothing here. React renders one <canvas> element, once; every subsequent
 * frame is an imperative draw in an effect. Putting the drawing in the render body
 * would tie frame rate to reconciliation, which is the classic way this pattern is got
 * wrong.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PRECISION_FUZZ } from '../core/types'
import type { Magnitude, Millis, Precision } from '../core/types'
import { localMidnight } from '../core/time'
import type { Camera } from './camera'
import { panBy, tOf, visibleRange, xOf, zoomAbout } from './camera'
import { activeBands, magnitudeOpacity, primaryBand } from './bands'
import { labelStrategy, ticksFor } from './ticks'

export interface TimelineBar {
  id: string
  title: string
  start: Millis
  end: Millis
  startPrecision: Precision
  endPrecision: Precision
  magnitude: Magnitude | null
  color: string | null
  /** Abandoned things dim, they don't disappear (§5.2). */
  dim?: boolean
  selected?: boolean
}

export interface TimelineCanvasProps {
  camera: Camera
  onCameraChange: (next: Camera) => void
  bars: readonly TimelineBar[]
  height?: number
  nowMs: Millis
  /** A click that wasn't a drag. The main page opens day lanes with this. */
  onPickDay?: (dayMs: Millis) => void
  onPickBar?: (barId: string) => void
  selectedDay?: Millis | null
}

const AXIS_H = 26
const BAR_H = 18
const BAR_GAP = 5
const TOP_PAD = 8
/** Past this many pixels of movement, a press is a drag and not a click. */
const DRAG_THRESHOLD = 4

const INK = '#e8e6e1'
const MUTED = 'rgba(232, 230, 225, 0.45)'
const GRID = 'rgba(232, 230, 225, 0.10)'
const BG = '#14161a'
const DEFAULT_BAR = '#7aa2f7'

export function TimelineCanvas({
  camera,
  onCameraChange,
  bars,
  height = 280,
  nowMs,
  onPickDay,
  onPickBar,
  selectedDay = null,
}: TimelineCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [width, setWidth] = useState(800)
  const drag = useRef<{ x: number; moved: number } | null>(null)
  /** Lane assignment from the last draw, so hit-testing agrees with what is on screen. */
  const laid = useRef<Array<TimelineBar & { lane: number }>>([])

  // --- size -----------------------------------------------------------------
  useLayoutEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const parent = el.parentElement
    if (!parent) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? parent.clientWidth
      setWidth(Math.max(1, Math.floor(w)))
    })
    ro.observe(parent)
    setWidth(Math.max(1, Math.floor(parent.clientWidth)))
    return () => ro.disconnect()
  }, [])

  // --- draw -----------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    laid.current = draw(ctx, { camera, bars, width, height, nowMs, selectedDay })
  }, [camera, bars, width, height, nowMs, selectedDay])

  // --- gestures -------------------------------------------------------------

  /**
   * Wheel handling is attached manually, not as a React `onWheel`, because React
   * attaches wheel listeners passively — `preventDefault()` inside one is ignored and
   * the browser zooms the whole page on ctrl+scroll. This is the one place the escape
   * hatch is necessary rather than convenient.
   */
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel arrives
        // in ~100px notches. Exponentiating the delta makes both feel the same.
        onCameraChange(zoomAbout(camera, x, Math.exp(-e.deltaY * 0.01)))
      } else {
        const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        onCameraChange(panBy(camera, -dx))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [camera, onCameraChange])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, moved: 0 }
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.x
      if (dx === 0) return
      d.moved += Math.abs(dx)
      d.x = e.clientX
      onCameraChange(panBy(camera, dx))
    },
    [camera, onCameraChange],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const d = drag.current
      drag.current = null
      if (!d || d.moved > DRAG_THRESHOLD) return // it was a pan, not a click

      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const hit = hitTest(laid.current, camera, x, y)
      if (hit && onPickBar) onPickBar(hit.id)
      else if (onPickDay) onPickDay(localMidnight(tOf(camera, x)))
    },
    [camera, onPickBar, onPickDay],
  )

  const [from, to] = visibleRange(camera, width)

  return (
    <div className="timeline">
      <canvas
        ref={canvasRef}
        className="timeline-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      />
      <div className="timeline-status">
        <span>{primaryBand(camera.scale).name} band</span>
        <span>
          {new Date(from).toISOString().slice(0, 10)} → {new Date(to).toISOString().slice(0, 10)}
        </span>
        <span>drag to pan · ctrl-scroll to zoom</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------

interface DrawArgs {
  camera: Camera
  bars: readonly TimelineBar[]
  width: number
  height: number
  nowMs: Millis
  selectedDay: Millis | null
}

function draw(
  ctx: CanvasRenderingContext2D,
  { camera, bars, width, height, nowMs, selectedDay }: DrawArgs,
): Array<TimelineBar & { lane: number }> {
  const [from, to] = visibleRange(camera, width)

  ctx.fillStyle = BG
  ctx.fillRect(0, 0, width, height)

  // --- selected day band, behind everything ---------------------------------
  if (selectedDay !== null) {
    const x0 = xOf(camera, selectedDay)
    const x1 = xOf(camera, selectedDay + 24 * 3_600_000)
    if (x1 > 0 && x0 < width) {
      ctx.fillStyle = 'rgba(122, 162, 247, 0.12)'
      ctx.fillRect(x0, 0, Math.max(x1 - x0, 1), height - AXIS_H)
    }
  }

  // --- grid + axis, one pass per active band, cross-faded -------------------
  for (const { band, opacity } of activeBands(camera.scale)) {
    const pxPerTick = band.unit * camera.scale
    const strategy = labelStrategy(pxPerTick)
    const ticks = ticksFor(band, from, to)

    ctx.save()
    ctx.globalAlpha = opacity
    for (const tick of ticks) {
      const x = Math.round(xOf(camera, tick.t)) + 0.5
      if (x < -200 || x > width + 200) continue
      ctx.strokeStyle = tick.emphasis ? 'rgba(232,230,225,0.22)' : GRID
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height - AXIS_H)
      ctx.stroke()

      const showLabel = strategy === 'all' || (strategy === 'emphasis' && tick.emphasis)
      if (showLabel) {
        ctx.fillStyle = tick.emphasis ? INK : MUTED
        ctx.font = `${tick.emphasis ? 600 : 400} 11px ui-sans-serif, system-ui, sans-serif`
        ctx.textBaseline = 'middle'
        ctx.fillText(tick.label, x + 4, height - AXIS_H / 2)
      }
    }
    ctx.restore()
  }

  // --- now -----------------------------------------------------------------
  const nowX = xOf(camera, nowMs)
  if (nowX >= 0 && nowX <= width) {
    ctx.strokeStyle = '#f7768e'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(Math.round(nowX) + 0.5, 0)
    ctx.lineTo(Math.round(nowX) + 0.5, height - AXIS_H)
    ctx.stroke()
  }

  // --- bars ----------------------------------------------------------------
  const visible = bars.filter(
    (b) => magnitudeOpacity(b.magnitude, camera.scale) > 0 && b.end >= from && b.start < to,
  )
  const placed = assignLanes(visible, camera, width)

  for (const bar of placed) {
    const alpha = magnitudeOpacity(bar.magnitude, camera.scale) * (bar.dim ? 0.35 : 1)
    if (alpha <= 0) continue
    const y = TOP_PAD + bar.lane * (BAR_H + BAR_GAP)
    if (y + BAR_H > height - AXIS_H) continue

    const x0 = xOf(camera, bar.start)
    const x1 = xOf(camera, bar.end)
    const w = Math.max(x1 - x0, 2)
    const color = bar.color ?? DEFAULT_BAR

    ctx.save()
    ctx.globalAlpha = alpha

    /**
     * RENDER PRECISION HONESTLY (§3). A 3pm meeting is a hard-edged bar; a decade-scale
     * goal is a soft gradient fading out at both ends. The fade length is the
     * precision's fuzz in *time*, converted to pixels here — so zooming does not change
     * how committed something looks, which would be the app editorialising.
     */
    const fadeIn = Math.min(PRECISION_FUZZ[bar.startPrecision] * camera.scale, w * 0.45)
    const fadeOut = Math.min(PRECISION_FUZZ[bar.endPrecision] * camera.scale, w * 0.45)

    if (fadeIn > 1 || fadeOut > 1) {
      const grad = ctx.createLinearGradient(x0, 0, x0 + w, 0)
      const inStop = Math.min(Math.max(fadeIn / w, 0), 0.5)
      const outStop = 1 - Math.min(Math.max(fadeOut / w, 0), 0.5)
      grad.addColorStop(0, hexA(color, fadeIn > 1 ? 0 : 0.85))
      grad.addColorStop(inStop, hexA(color, 0.85))
      grad.addColorStop(outStop, hexA(color, 0.85))
      grad.addColorStop(1, hexA(color, fadeOut > 1 ? 0 : 0.85))
      ctx.fillStyle = grad
    } else {
      ctx.fillStyle = hexA(color, 0.85)
    }
    ctx.fillRect(x0, y, w, BAR_H)

    if (bar.selected) {
      ctx.strokeStyle = INK
      ctx.lineWidth = 1.5
      ctx.strokeRect(x0 + 0.75, y + 0.75, w - 1.5, BAR_H - 1.5)
    }

    // Label inside the bar when it fits, otherwise just past its right edge. A bar
    // narrower than its own name is common at month scale and must not go unlabelled.
    const label = bar.title
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    const textW = ctx.measureText(label).width
    if (w > textW + 12) {
      ctx.fillStyle = '#10121a'
      ctx.fillText(label, x0 + 6, y + BAR_H / 2)
    } else if (x1 + textW < width) {
      ctx.fillStyle = MUTED
      ctx.fillText(label, x1 + 6, y + BAR_H / 2)
    }
    ctx.restore()
  }

  // axis rule
  ctx.strokeStyle = 'rgba(232,230,225,0.18)'
  ctx.beginPath()
  ctx.moveTo(0, height - AXIS_H + 0.5)
  ctx.lineTo(width, height - AXIS_H + 0.5)
  ctx.stroke()

  return placed
}

/**
 * Greedy lane packing: first lane whose last bar ends before this one starts (plus a
 * few pixels of breathing room so two abutting bars are visibly two).
 *
 * Bars are sorted by start, which is what makes greedy optimal-enough here — it is the
 * interval-partitioning problem, and left-to-right greedy uses the minimum number of
 * lanes for a set of intervals. Not a heuristic; it is the known answer.
 */
function assignLanes(
  bars: readonly TimelineBar[],
  camera: Camera,
  width: number,
): Array<TimelineBar & { lane: number }> {
  const sorted = [...bars].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  const laneEnds: number[] = []
  const out: Array<TimelineBar & { lane: number }> = []

  for (const bar of sorted) {
    const x0 = xOf(camera, bar.start)
    const x1 = Math.max(xOf(camera, bar.end), x0 + 2)
    // Reserve room for a trailing label so two short bars don't overlap each other's text.
    const reserved = x1 + (x1 - x0 < 60 ? 70 : 8)
    let lane = laneEnds.findIndex((end) => end <= x0)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(reserved)
    } else {
      laneEnds[lane] = reserved
    }
    out.push({ ...bar, lane })
    void width
  }
  return out
}

function hitTest(
  placed: ReadonlyArray<TimelineBar & { lane: number }>,
  camera: Camera,
  x: number,
  y: number,
): TimelineBar | null {
  for (const bar of placed) {
    const top = TOP_PAD + bar.lane * (BAR_H + BAR_GAP)
    if (y < top || y > top + BAR_H) continue
    const x0 = xOf(camera, bar.start)
    const x1 = Math.max(xOf(camera, bar.end), x0 + 2)
    if (x >= x0 && x <= x1) return bar
  }
  return null
}

/** `#rrggbb` + alpha → rgba(). Accepts an already-rgba colour unchanged. */
function hexA(color: string, alpha: number): string {
  if (!color.startsWith('#') || (color.length !== 7 && color.length !== 4)) return color
  const hex =
    color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

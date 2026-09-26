/**
 * Main page — answers WHEN.
 *
 * A continuous time axis, one-off spans, zoom across scales. A projection over the
 * store; it owns no tables of its own (§8).
 *
 * Magnitude is the zoom filter (§4): micro+kilo at day scale, mega at month, tera at
 * decade. This is what keeps the view legible once there are thousands of nodes, which
 * there will be within a year.
 *
 * The page owns the camera rather than the canvas doing so, for two reasons: the
 * scheduler will eventually want to share one, and a camera in page state is trivially
 * serializable into a saved view later. The canvas stays a pure renderer.
 *
 * DROP-TO-SCHEDULE
 * ----------------
 * Dragging an inbox item onto the timeline is the moment an undated thought earns a
 * date. It lands with `day` precision, not `exact` — the drop is accurate to a few
 * pixels, and pixels at month zoom are days. Claiming `exact` would be the UI telling
 * the honesty lie §3 exists to prevent.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { DAY_MS, addDays, localMidnight, now } from '../../core/time'
import type { Millis, Node } from '../../core/types'
import { useQuery, useStore } from '../../store/useStore'
import { TimelineCanvas } from '../../timeline/TimelineCanvas'
import type { TimelineBar } from '../../timeline/TimelineCanvas'
import type { Camera } from '../../timeline/camera'
import { describeScale, fitRange, tOf, zoomAbout } from '../../timeline/camera'
import { DayLanes } from './DayLanes'
import { InboxRail } from './InboxRail'

export function MainPage() {
  const store = useStore()
  const nowMs = useMemo(() => now(), [])
  const [camera, setCamera] = useState<Camera>(() =>
    fitRange(nowMs - 10 * DAY_MS, nowMs + 20 * DAY_MS, 900),
  )
  const [selectedDay, setSelectedDay] = useState<Millis | null>(localMidnight(nowMs))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  /**
   * One range query, widened well past the viewport so panning does not re-query on
   * every frame. The widening is the cheap half of culling: the canvas still draws only
   * what is visible, this just stops the store being hit 60 times a second.
   */
  const bars: TimelineBar[] = useQuery(
    (s) => {
      const pad = (1 / camera.scale) * 4000
      const from = camera.tOrigin - pad
      const to = camera.tOrigin + pad * 2
      return s.spansInRange(from, to).map(({ node, span }) => ({
        id: node.id,
        title: node.title,
        start: span.start_ms ?? 0,
        end: span.end_ms ?? span.start_ms ?? 0,
        startPrecision: span.start_precision,
        endPrecision: span.end_precision,
        magnitude: node.magnitude,
        color: node.color,
        dim: node.status === 'abandoned',
        selected: node.id === selectedId,
      }))
    },
    [camera.tOrigin, camera.scale, selectedId],
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const id = e.dataTransfer.getData('text/plain')
      const node = id ? store.getNode(id) : undefined
      if (!node) return
      const rect = e.currentTarget.getBoundingClientRect()
      const dropped = localMidnight(tOf(camera, e.clientX - rect.left))
      store.setSpan(node.id, {
        start_ms: dropped,
        start_precision: 'day',
        end_ms: addDays(dropped, 1),
        end_precision: 'day',
      })
      setSelectedId(node.id)
      setSelectedDay(dropped)
    },
    [camera, store],
  )

  const selected = selectedId ? store.getNode(selectedId) : undefined

  return (
    <div className="page main-page">
      <InboxRail
        selectedId={selectedId}
        onSelect={(n: Node) => setSelectedId(n.id)}
      />

      <div className="main-surface">
        <div className="toolbar">
          <button onClick={() => setCamera((c) => zoomAbout(c, 450, 1 / 1.6))}>−</button>
          <button onClick={() => setCamera((c) => zoomAbout(c, 450, 1.6))}>+</button>
          <button
            onClick={() =>
              setCamera(fitRange(nowMs - 10 * DAY_MS, nowMs + 20 * DAY_MS, surfaceWidth(surfaceRef)))
            }
          >
            today
          </button>
          <button
            onClick={() =>
              setCamera(
                fitRange(nowMs - 365 * DAY_MS, nowMs + 3650 * DAY_MS, surfaceWidth(surfaceRef)),
              )
            }
          >
            decade
          </button>
          <span className="hint">{describeScale(camera.scale)}</span>
        </div>

        <div
          ref={surfaceRef}
          className="canvas-host"
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={onDrop}
        >
          <TimelineCanvas
            camera={camera}
            onCameraChange={setCamera}
            bars={bars}
            nowMs={nowMs}
            selectedDay={selectedDay}
            onPickDay={(d) => {
              setSelectedDay(d)
              setSelectedId(null)
            }}
            onPickBar={(id) => setSelectedId(id)}
          />
        </div>

        <div className="split">
          <DayLanes
            day={selectedDay}
            selectedId={selectedId}
            onSelect={(n) => setSelectedId(n?.id ?? null)}
          />
          <Inspector node={selected ?? null} />
        </div>
      </div>
    </div>
  )
}

const surfaceWidth = (ref: React.RefObject<HTMLDivElement | null>) =>
  ref.current?.clientWidth ?? 900

/**
 * The smallest thing that can act on a selection: retitle, classify, abandon.
 *
 * Every control here writes through the store, so every one of them lands in the event
 * log with `{before, after}` (§5.4) without this component knowing that. Abandon sets a
 * status; it does not delete, and the bar dims rather than vanishing (§5.2).
 */
function Inspector({ node }: { node: Node | null }) {
  const store = useStore()
  const types = useQuery((s) => s.listNodeTypes())

  if (!node) {
    return (
      <section className="inspector empty">
        <p>select something</p>
      </section>
    )
  }

  return (
    <section className="inspector">
      <input
        className="inspector-title"
        value={node.title}
        onChange={(e) => store.updateNode(node.id, { title: e.target.value })}
      />

      <label>
        type
        <select
          value={node.type ?? ''}
          onChange={(e) => store.updateNode(node.id, { type: e.target.value || null })}
        >
          <option value="">—</option>
          {types.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        magnitude
        <select
          value={node.magnitude ?? ''}
          onChange={(e) =>
            store.updateNode(node.id, {
              magnitude: (e.target.value || null) as Node['magnitude'],
            })
          }
        >
          <option value="">—</option>
          {['micro', 'kilo', 'mega', 'giga', 'tera'].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={() =>
          store.updateNode(node.id, {
            status: node.status === 'abandoned' ? null : 'abandoned',
          })
        }
      >
        {node.status === 'abandoned' ? 'un-abandon' : 'abandon'}
      </button>

      <Links node={node} />
    </section>
  )
}

/**
 * Edges, at last given a way in.
 *
 * The schema and `link`/`unlink` have existed since Phase 1 with nothing able to invoke
 * them, which made "contents are nodes joined by edges" (DESIGN § Blocks and contents)
 * an unreachable claim. This is the desktop half; the phone half is the alarm's "what
 * now", which creates a node and links it to the occurrence that failed (§9).
 *
 * Relation names are user vocabulary (§2) — free text with suggestions from what
 * already exists, never a fixed list. `datalist` rather than a `select`, so a new
 * relation costs no more than reusing an old one.
 */
function Links({ node }: { node: Node }) {
  const store = useStore()
  const edges = useQuery((s) => s.edgesForNode(node.id), [node.id])
  const nodes = useQuery((s) => new Map(s.listNodes().map((n) => [n.id, n])))
  const relations = useQuery((s) => [...new Set(s.listNodes().flatMap((n) => s.edgesForNode(n.id).map((e) => e.relation)))])
  const [target, setTarget] = useState('')
  const [relation, setRelation] = useState('relates to')

  return (
    <div className="links">
      <span className="hint">links</span>
      <ul>
        {edges.map((edge) => {
          const outgoing = edge.from_node === node.id
          const other = nodes.get(outgoing ? edge.to_node : edge.from_node)
          return (
            <li key={edge.id}>
              <span className="relation">{outgoing ? edge.relation : `← ${edge.relation}`}</span>
              <span>{other?.title ?? '—'}</span>
              <button className="link" onClick={() => store.unlink(edge.id)}>
                unlink
              </button>
            </li>
          )
        })}
        {edges.length === 0 && <li className="empty">none</li>}
      </ul>

      <div className="add">
        <input
          list="spatium-relations"
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
        />
        <datalist id="spatium-relations">
          {relations.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">pick a node…</option>
          {[...nodes.values()]
            .filter((n) => n.id !== node.id)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
        </select>
        <button
          disabled={!target || !relation.trim()}
          onClick={() => {
            store.link(node.id, target, relation.trim())
            setTarget('')
          }}
        >
          link
        </button>
      </div>
    </div>
  )
}

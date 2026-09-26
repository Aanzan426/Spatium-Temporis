/**
 * emit.ts — step 4 of SPEC §4. The `Emitter` interface, and exactly one emitter.
 *
 * WHY ONLY ONE
 * ------------
 * What a *training example* looks like depends entirely on which task is being
 * fine-tuned, and that has not been chosen. The candidates are structurally different —
 * classification ("where does this new thought belong?"), generation ("decompose this
 * goal"), sequence over the event log ("how does this person re-plan when something
 * slips"). Writing one now means writing four and discarding three.
 *
 * So: the interface ships, and `raw` ships, which dumps normalized records verbatim.
 * That is immediately useful for seeing what you actually have. Training emitters land
 * when there is a task.
 *
 * An emitter is one (domain × task) pair, not one per domain: "schedule adherence: why
 * things get missed" and "schedule structure: how a week gets laid out" are two
 * emitters over identical rows.
 */

import type { Normalized, NormalizedBlock } from './normalize'

export interface Emitter {
  name: string
  description: string
  /** One object per JSONL line. */
  emit(data: Normalized): Iterable<object>
}

/**
 * §3.12 — deterministic output, so generated datasets can be diffed.
 *
 * Stable key order is the half people forget: `JSON.stringify` follows insertion order,
 * so two records built by different code paths can serialize differently while being
 * the same record. Sorting the keys makes the bytes a function of the content alone.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      )
    }
    return v
  })
}

/**
 * Verbatim normalized records, one per line, with the window they came from attached.
 *
 * No timestamps are generated: `_meta.exported_at` is carried through instead, so
 * re-running this over the same workbook is byte-identical (§3.12). A `generated_at`
 * field would be the single thing making every output differ from every other.
 */
export const rawEmitter: Emitter = {
  name: 'raw',
  description: 'normalized rows, verbatim, one JSON object per line',
  *emit(data: Normalized) {
    const windows = new Map(data.windows.map((w) => [w.id, w]))
    for (const row of data.rows) {
      const window = windows.get(row.windowId)
      yield {
        ...stripInternals(row),
        window: window
          ? { id: window.id, label: window.label, start: window.start, end: window.end }
          : null,
        source: { tz: data.meta.tz, exported_at: data.meta.exportedAt, sheet: row.sheet },
      }
    }
  },
}

/**
 * `rowNumber` and `sheet` are workbook coordinates, not data — a row that moves because
 * something above it was deleted would otherwise produce a different training record
 * for identical content. `sheet` is re-attached under `source` where it belongs, as
 * provenance.
 */
function stripInternals(row: NormalizedBlock): Record<string, unknown> {
  const { rowNumber: _r, sheet: _s, windowId: _w, ...rest } = row
  return rest
}

export const EMITTERS: readonly Emitter[] = [rawEmitter]

export const emitterByName = (name: string): Emitter | undefined =>
  EMITTERS.find((e) => e.name === name)

/** The whole file, as text. Every line is one object; the file ends with a newline. */
export function toJsonl(emitter: Emitter, data: Normalized): string {
  const lines: string[] = []
  for (const record of emitter.emit(data)) lines.push(stableStringify(record))
  return lines.length ? `${lines.join('\n')}\n` : ''
}

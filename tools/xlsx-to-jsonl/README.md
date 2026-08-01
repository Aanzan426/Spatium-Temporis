# xlsx → jsonl

Offline helper. Reads curated `.xlsx` exports and emits training JSONL.

The loop: export from the app → review and edit by hand in a spreadsheet → convert the
curated sheets to JSONL → fine-tune locally. The spreadsheet is where a human decides
what is worth training on.

**Runs offline, on-device.** This dataset is an entire inner life; keeping processing
local is the point of the local-SLM plan in the first place.

## Requirements

- Rejoin every row to the database on its `id` column. Flattening to a grid destroys
  nesting; the id is what recovers it. A row without an id cannot be trusted.
- One sheet per period. `period` becomes a field on each emitted record.
- JSONL, not CSV: one JSON object per line, nesting preserved, which is what every
  training pipeline expects.
- Emit deterministically so re-running over the same input produces identical output —
  it makes diffing generated datasets possible.

## Status

**In progress.** [`SPEC.md`](SPEC.md) is the full specification — workbook layout, types,
the emitter interface, the edge cases, and the build order.

The tool splits in two, and only one half is knowable yet:

- **Reader → normalized records** — buildable now; the schema is pinned in `docs/DESIGN.md` §2
- **Records → training examples** — deferred. The shape depends entirely on which task gets
  fine-tuned, and that hasn't been chosen. Ship a pluggable emitter interface with one `raw`
  emitter; add training emitters when there's a task.

Building it before the exporter exists is deliberate: testing it means defining the workbook
layout, which makes **this tool the spec that `src/export/xlsx.ts` has to satisfy**.

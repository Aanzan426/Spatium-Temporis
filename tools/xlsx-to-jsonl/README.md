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

**Phase 1.5 / 2.** Deliberately not built yet — the record format is a guess until a
fine-tune has actually been attempted, and it re-emits from full history whenever it is
finally written. See `docs/DESIGN.md` §11.

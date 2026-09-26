# Spatium Temporis

A personal life-planning system: a dynamic, linkable, zoomable map of everything the user
thinks about — projects, goals, books, workouts, ideas, dreams, long shots — across time
scales from hours to decades.

**Read [`docs/HANDOFF.md`](docs/HANDOFF.md) first**, then `docs/DESIGN.md`. The handoff
is the orientation: what exists today, what is verified, what is load-bearing, and the
traps that are not obvious from the code. `DESIGN.md` is the reasoning underneath it.

**`docs/DESIGN.md`** It holds the data model, the precision and magnitude specs,
the timeline zoom mechanic, the phase roadmap, and the reasoning behind each. Don't
re-derive those decisions; if one is wrong, change it *and update the doc*.

`docs/documentation/YYYY-MM-DD.md` is a dated work log and teaching reference — what
happened, why, what got reversed, and explanations of concepts as they came up. `DESIGN.md`
holds the current state and loses history; the log keeps it. **At the end of a working
session, append that day's entry** (or create it): decisions with reasoning, reversals,
exact commands and their real output, files changed with line counts, concepts introduced.
Accuracy over tidiness — verify before writing, and never edit a past entry except to append
a dated correction.

## Working agreement

**The user writes the code. Claude designs, guides, explains and reviews.**

> This was suspended once, on 2026-09-26, at the user's explicit request — Phases 1 and
> 2 were implemented by Claude in a single day. It is **back in force by default.** Do
> not write implementation code unless asked for it in this session; being asked in a
> previous one does not carry over.

The user wants to become fluent in this stack, not to receive a finished app. So: hand over
the design for a piece, answer questions, review what comes back, catch problems early.
Don't write implementation code unless explicitly asked for it. Docs, schemas, specs and
review are in scope.

The plan is expected to change repeatedly — plan, build, re-plan, build. Treat `DESIGN.md`
as a living checkpoint, never a contract.

## Invariants

These are cheap now and impossible to retrofit. Don't let them slip:

1. **Capture is never gated on classification** — `type`, `span` and links are all nullable.
   A title and a timestamp is a valid node. Never require a category before accepting input.
2. **Nothing is deleted** — abandoned things dim, they don't disappear.
3. **Append-only `events` log on every write** — this is the training corpus for the eventual
   apprentice model. Unrecorded history cannot be recovered.
4. **Event payloads carry `{before, after}`** — a payload that only names what changed is
   unreplayable, and silently destroys both revision history and the training corpus.
5. **Past occurrences are frozen, future ones generated** — editing a recurrence rule must
   never rewrite history.
6. **ULIDs everywhere, never autoincrement ids.**
7. **UTC epoch ms stored, local time rendered, a real date library used.**
8. **No domain ever gets its own table or code path** — domains are runtime data.
9. **Every page is a projection over the one store** — no page-specific tables.
10. **Anything defined in more than one place will drift** — define it once as data and derive
    the rest. `src/export/workbook-layout.ts` is the pattern: columns are an `as const` array,
    row types are mapped from it, and adding a column breaks every consumer at compile time.
11. **Generated files are never hand-edited.** Fixture workbooks come from `tools/`; edit the
    source and re-run.
12. **Occurrence ids are derived from `(node_id, date_ms)`, never minted** — see
    `src/core/derived-ids.ts`. This is what makes a two-device merge idempotent. Changing
    that function forks every future occurrence away from every past one, so it is
    effectively frozen. It must also keep producing a valid ULID: the workbook validates
    every id as 26 characters of Crockford base32.
13. **Every write records which device made it, and every outcome records when it was
    answered.** `events.device_id` and `occurrences.answered_at`. Neither can be
    backfilled, and `answered_at - end_ms` is the only way to tell a prompt answer from
    a reconstruction (§9).

## Tools

`tools/` holds Node CLIs run with `tsx` (Node 20 cannot strip types natively). They are
consumers of the app, never imported by it. `tsconfig.json` includes `tools` and sets
`esModuleInterop`, which the CommonJS `exceljs` import requires.

- `tools/xlsx-to-jsonl/` — the curation → training-data converter. Read `SPEC.md` first.
  `sample.ts` and `broken.ts` generate the two fixtures; `roundtrip.ts` is its test.
- `tools/store-check.ts` — replay-equals-state, the frozen-past rule, the two-device
  merge, and the only place `001_init.sql` actually runs (via Node 22's `node:sqlite`).
- `tools/merge-snapshot.ts` — union two snapshots' event logs and replay. Never restore
  one device's snapshot over the other's database; see `docs/ANDROID.md`.

`npm run check` runs the typecheck and both scripts. There is no test runner and does not
need to be one: they exit non-zero.

## Stack

- React + TypeScript + Vite
- Canvas 2D for the timeline (not SVG, not DOM — thousands of ticks and bars)
- SQLite behind a `Store` interface — wa-sqlite/sql.js now, native SQLite later
- Capacitor → Android APK, built by CI (`docs/ANDROID.md`). The PWA is still unimplemented
  despite §7 claiming it. The `Store` interface is what keeps each packaging a swap
- Phone = capture **and adherence**. Desktop = structure and visualize. One database,
  two views. See §7's 2026-09-26 revision: the dividing line is *time-critical work goes
  where the device is*, not screen size
- `src/bootstrap.ts` is the only file that knows which platform it is on

## Current phase

**Phase 2 — Android and adherence.** Phase 1 is implemented and verified (both pages,
the store, the event log, the converter, the exports). Phase 2 has the phone view, the
end-of-block alarm, the two-device merge and the Capacitor wrapper built; what remains is
listed in `docs/HANDOFF.md`. Phase 1's full scope, and what is deliberately excluded, is
still `docs/DESIGN.md` §10.

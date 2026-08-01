# Spatium Temporis

A personal life-planning system: a dynamic, linkable, zoomable map of everything the user
thinks about — projects, goals, books, workouts, ideas, dreams, long shots — across time
scales from hours to decades.

**Read `docs/DESIGN.md` first.** It holds the data model, the precision and magnitude specs,
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

## Stack

- React + TypeScript + Vite
- Canvas 2D for the timeline (not SVG, not DOM — thousands of ticks and bars)
- SQLite behind a `Store` interface — wa-sqlite/sql.js now, native SQLite later
- Ships as a PWA now; Capacitor → Android APK in Phase 2; the `Store` interface is what
  keeps each of those a swap rather than a rewrite
- Phone = capture only. Desktop = structure and visualize. One database, two views.

## Current phase

**Phase 1 — two pages.** Main page (timeline + inbox + day-lanes) and Scheduler page
(week/month fold, tiny recurrence subset, per-occurrence outcomes, "as of" revision
scrubber). Full scope in `docs/DESIGN.md` §10, including what is deliberately excluded.

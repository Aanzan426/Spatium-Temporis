# Spatium Temporis

A dynamic, linkable, zoomable map of everything I think about — projects, goals, books,
workouts, ideas, dreams, long shots — across time scales from hours to decades.

Not a task manager. A place to put a mind in front of its own eyes.

**Design and rationale: [`docs/DESIGN.md`](docs/DESIGN.md).** Read it before touching
anything. It is a living document — when the plan changes, it changes.

**Work log: [`docs/documentation/`](docs/documentation/).** One dated file per working day —
what happened, why, what was reversed, and explanations of anything new. `DESIGN.md` holds
the current state and loses history; the log keeps it.

## Status

**Phase 1**, two pages: the main timeline and the scheduler. Scope and deliberate
exclusions in `docs/DESIGN.md` §10.

## Running

```bash
npm install
npm run dev
```

## Layout

```
src/core/       domain model. no React, no DOM, no storage. pure.
src/store/      persistence behind one interface — what keeps web/APK/desktop a swap
src/timeline/   the time transform + canvas. page-agnostic; both pages use it
src/pages/      projections over the store. never their own tables
src/export/     snapshots and spreadsheets, generated on demand — never maintained
tools/          offline helpers (xlsx → training jsonl)
```

## A warning that is already in `.gitignore`

Never commit the database or any export. This repository is public; the data is not.

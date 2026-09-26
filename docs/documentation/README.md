# Documentation — work log and teaching reference

Two kinds of file:

- **`YYYY-MM-DD.md`** — one per working day. What happened, when, why. Never rewritten.
- **`reference/*.md`** — standing teaching documents on one topic. Updated as understanding
  grows, unlike the dated entries.

This is not the design doc. `docs/DESIGN.md` says what the system **is right now** and gets
rewritten whenever the plan turns. These files say **what happened, when, and why** — and
they are never rewritten. If a decision here was later reversed, the entry stays as written
and the reversal is recorded in the later entry.

That distinction is the whole point. `DESIGN.md` loses history by design; this folder keeps
it. Between them you can always answer "why is it like this?" and "what did I think before?"

> **Starting a session?** [`docs/HANDOFF.md`](../HANDOFF.md) is the orientation
> document — what exists, what is verified, what is load-bearing and why, and where the
> traps are. These dated entries are the history behind it.

## What each entry contains

- **State at start / state at end** — commits, what was tracked, what ran
- **Decisions made**, each with the reasoning and what it replaced
- **Decisions reversed** — the most valuable section. Record what was wrong and why
- **Exact commands run and their real output** — not summaries
- **Files created or changed**, with line counts
- **Concepts** — a teaching section explaining anything new that came up, properly, not as
  a glossary stub
- **Open questions** and **the next concrete step**

## Rules

1. **Accuracy over tidiness.** Verify before writing. If something wasn't checked, say it
   wasn't checked rather than assuming.
2. **No generalizations.** "Set up the project" is useless in four months. "npm install
   added 33 packages; `tsc --noEmit` exited 0; build emitted 190.77 kB" is not.
3. **Record the reversals.** A log that only contains decisions that survived is a lie, and
   the discarded reasoning is usually the part worth re-reading.
4. **Never edit a past entry** except to append a correction, dated and marked as such.

## Index

**Daily entries**

- [2026-09-26](2026-09-26.md) — Two sessions in one day, one file.
  **Morning, §§1–7: Phase 1 implementation.** Every stub filled in, the converter
  finished (`read` → `normalize` → `emit` → `cli`), a dependency-free XLSX writer, and
  two verification scripts. 3 reversed decisions, 3 bugs found by the scripts on their
  first run.
  **Evening, §§8–13: Phase 2, Android.** The phone view, the end-of-block alarm, the
  two-device merge, the Capacitor wrapper and CI for the APK. §7's device split revised.
  Two columns and a derived-id scheme added while the only data was still `seed.ts`.
- [2026-08-01](2026-08-01.md) — Day 1. Design from scratch, `DESIGN.md`, `CLAUDE.md`, full
  Phase 1 scaffold and first push (`ce85740`); then the converter spec and fixture generator,
  the single-source workbook layout, the Arbor side project, and an eleven-month learning
  plan. 21 sections, 4 reversed decisions, 3 bugs found.

**Reference**

> The Aug 2026 → Jun 2027 learning plan lived here briefly and has moved to its own repo,
> along with its generator (`tools/learning-plan/`). Recorded in
> [2026-08-01](2026-08-01.md) §15 for the reasoning; the files themselves are no longer here.

- [react-and-vite](reference/react-and-vite.md) — every React and Vite decision in this repo,
  from zero knowledge. Line-by-line walkthroughs of `index.html`, `main.tsx`, `App.tsx`,
  `vite.config.ts`, `tsconfig.json` and `package.json`; the React render model; the
  React-plus-canvas pattern needed for the timeline; and the gotchas ranked by how soon they
  bite.

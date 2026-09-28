# Handoff

**Read this first.** It is the orientation document for anyone — human or model — picking
this project up. It says what exists, what is proven, what is load-bearing, and where the
traps are.

It is not the design document. `DESIGN.md` holds the reasoning and is the authority on
*why*; the dated files in `documentation/` hold the history and are never rewritten. This
file holds the *current state* and gets rewritten whenever the state changes. If it
contradicts `DESIGN.md`, `DESIGN.md` wins on intent and this file wins on what the code
actually does today.

Last rewritten: 2026-09-26.

---

## 0. The thirty-second version

A personal life-planning system: a zoomable, linkable map of everything one mind thinks
about, across scales from hours to decades. **Not a task manager.**

Everything follows from one requirement:

> The gap between a thought existing in my head and existing on screen must be near zero.

Four hardcoded concepts — `node`, `edge`, `span`, `event`. Everything above them (types,
statuses, relations, categories) is data the user creates at runtime. No domain ever gets
its own table, screen or code path.

Phases 1 and 2 were both implemented on 2026-09-26. Before that the repo was design
documents and stubs.

---

## 1. Working agreement — read this before writing code

`CLAUDE.md` says: **the user writes the code; Claude designs, guides, explains and
reviews.** The user is learning this stack, not collecting an app.

That was suspended once, on 2026-09-26, at the user's explicit request, and Phases 1–2
were written by Claude in a day. **It is back in force by default.** Being asked to
implement in a previous session does not carry over. Docs, schemas, specs, review and
design are always in scope; implementation code is not, unless asked for in the current
session.

If you do implement, `documentation/` must record that you did. The authorship of a
7,000-line day is a real question four months later, and the log is the only thing that
can answer it.

---

## 2. What exists, and what is proven

```
npm install
npm run check      # typecheck + both verification scripts. This is the test suite.
npm run dev        # desktop view in a browser
```

| Area | State |
|---|---|
| Core model, time, recurrence, ids | Built |
| Store interface, MemoryStore, event log, replay | Built, asserted |
| SqliteStore + schema | Built, asserted headless — **never run in a browser** |
| Timeline (camera, bands, ticks, canvas) | Built, desktop only, **no pinch zoom** |
| Main page, scheduler page, revision strip, compare table | Built |
| Phone view (capture / today / inbox) | Built, **never run on a real phone** |
| End-of-block alarm | Built, **never fired on a real device** |
| xlsx export, JSON snapshot, zip writer | Built, round-trip asserted |
| xlsx → jsonl converter | Built, all five SPEC §4 steps |
| Two-device merge | Built, asserted |
| Capacitor wrapper + CI for the APK | Building; installed on a phone. The persistence root cause (dynamic plugin import → `MemoryStore` fallback) was fixed on 2026-09-27 — **awaiting on-device re-verification** |
| PWA | **Not built.** §7 claims it exists. It does not |
| sql.js on the web path | **Not wired.** The desktop is still memory-backed |

The bolded rows are the honest edge of this project: a great deal is verified by scripts
and none of the mobile half has met a real device. Treat "built" as "typechecks and
passes its assertions", not "works in your hand".

### The two verification scripts

There is no test runner and there does not need to be one — both scripts exit non-zero.

**`tools/store-check.ts`** — 19 checks. Replay-equals-state (which is DESIGN §5.4's
request for exactly this script), `replayAt` equals N independent replays, the frozen
past, idempotent materialization, derived ids, the two-device merge, and the only place
`001_init.sql` actually executes (via Node 22's built-in `node:sqlite`).

**`tools/xlsx-to-jsonl/roundtrip.ts`** — 16 checks. Exports a workbook with the app's own
writer, reads it back with a *different library*, asserts every row rejoins to the
occurrence it came from, asserts the JSONL is byte-identical across runs, and asserts
every deliberate fault in `broken.ts` is caught.

Both have already earned their keep: the round trip found a timezone bug on its first run
that would have been invisible for months (see §5 below).

---

## 3. The invariants — what will break everything if you violate it

`CLAUDE.md` lists thirteen. These are the ones most likely to be violated by accident:

1. **Capture is never gated on classification.** `type`, `span` and links are nullable. A
   title and a timestamp is a valid node. Every field added to a capture form is a reason
   to stop using the app. This is why the inbox rail and the phone's capture tab have
   exactly one input and no other control.

2. **Nothing is deleted.** Abandoned things dim. The only `DELETE` in the codebase is
   unlinking an edge, and even that keeps the event.

3. **Every write appends an event, with `{before, after}` whole rows.** A payload that
   only names what changed is unreplayable. This is not enforced by discipline:
   `MemoryStore.commit()` is the only path that mutates, and `SqliteStore.persist()`
   writes rows *out of the events*, so an unlogged write would also be an unpersisted
   write.

4. **Past occurrences are frozen; future ones are generated.** `expand()` takes a
   `frozenBefore` boundary and physically cannot emit a projection at or before it. There
   is no way to ask the module for a generated past.

5. **Occurrence ids are derived from `(node_id, date_ms)`.** Two devices produce the same
   id for the same block, so a merge deduplicates itself. `src/core/derived-ids.ts` is
   effectively frozen — changing it forks every future occurrence from every past one.
   It must keep producing a **valid ULID**, because the converter validates every
   workbook id as 26 characters of Crockford base32.

6. **Anything defined twice will drift.** `src/export/workbook-layout.ts` is the pattern:
   columns are an `as const` array, row types are mapped from it, and adding a column
   breaks every consumer at compile time. This has already worked twice in anger.

---

## 4. Architecture in one pass

```
src/core/        pure. no React, no DOM, no storage
src/store/       Store interface + implementations. THE platform seam
src/timeline/    camera + bands + ticks + canvas. page-agnostic
src/pages/       main/, scheduler/, phone/. projections over the one store
src/alarms/      the end-of-block alarm and the outcome it collects
src/export/      snapshots, workbooks, a hand-written zip writer
src/bootstrap.ts THE ONLY FILE THAT KNOWS WHICH PLATFORM IT IS
tools/           converter + verification scripts. consumers, never imported by the app
```

**The Store seam.** Nothing above `src/store/` imports SQLite, IndexedDB, Capacitor or
Tauri. That is what keeps web → APK → desktop a swap. If you find a storage import in
`src/pages` or `src/timeline`, something has gone wrong.

**The driver seam**, one level below it: `SqlDatabase` is four methods, and each platform
gets a ten-line adapter (`sqljs`, `node-sqlite`, `capacitor`). This is also why the app
typechecks with no SQLite package installed — the dependency is injected, not imported.

**The timeline is one transform, not eight views.** The camera is two numbers, `scale`
and `tOrigin`. The active band is *derived* from `scale`, never switched. If a third
piece of camera state appears — a "mode", a "zoom level" enum — the eight-views problem
is creeping back.

**Magnitude is the zoom filter.** Zoom selects which magnitudes render. Without it every
zoom renders everything, the view becomes noise at a few thousand nodes, and the tool
dies. A node with *no* magnitude always renders, because capture is never gated.

**The scheduler is the timeline folded on a cycle.** Week vs month is one data entry in
`FOLDS`, not two implementations.

---

## 5. Traps — things that have already bitten, or will

**Excel dates.** Every cell in the workbook is written as text, deliberately. A `Date` or
`number` arriving in the reader means the *export* is broken; it is reported, never
decoded. Decoding would mean implementing Excel's 1900 leap-year bug.

**`_meta.tz` names the zone the dates were rendered in — it does not convert into them.**
This cost the round trip its first run: the exporter renders with the machine's local
calendar, and passing a different `tz` produced UTC dates labelled `Asia/Kolkata` with
every row rejoining 5h30m off. No error anywhere. `npm run check:roundtrip` now runs under
`TZ=Asia/Kolkata` so the check happens outside UTC, where the bug hides.

**`new Date('2026-08-01')` is midnight UTC**, which is the previous day in any
negative-offset zone. Use `parseLocalDate`. `occurrences.date_ms` is *local* midnight, and
getting that wrong looks exactly like random corruption twice a year.

**exceljs is CommonJS with an ES-shaped `.d.ts`.** `import { Workbook } from 'exceljs'`
typechecks clean and throws at runtime. Use the default import. A passing typecheck does
not mean a CJS import works — run it.

**Vite's `?raw` is a bundler feature.** `SqliteStore` takes the migration SQL as an
*argument* for this reason: a static `?raw` import made the class unrunnable outside a
Vite build, which would have meant the schema's first execution ever was in a browser, by
hand.

**React attaches `onWheel` passively**, so `preventDefault()` is ignored and ctrl+scroll
zooms the whole page. `TimelineCanvas` uses a manual listener with `{ passive: false }`.

**`useSyncExternalStore`'s snapshot must be referentially stable.** A selector returning a
fresh array loops forever. `useQuery` subscribes to the version *number* and derives in a
memo.

**Android: Doze.** Without `allowWhileIdle` and `SCHEDULE_EXACT_ALARM`, alarms are batched
into whatever window the OS feels like — and a prompt ninety minutes late is asking for
reconstruction, which is the thing the alarm exists to prevent.

**Android: a dynamic `import()` of a bare specifier cannot resolve in the WebView.**
`import('@capacitor-community/sqlite')` survives Vite's bundling untouched — Vite leaves
it alone precisely because it is dynamic — and a WebView has no `node_modules` and no
import map to resolve it against. It rejected on every device launch, the catch fell
back to the `MemoryStore`, and the app "lost all data" for a week before anyone could
name the cause. The plugins are static imports now (see `bootstrap.ts`'s header): the
web bundle carries their `registerPlugin` stubs, which is harmless. And the failure mode
is visible now — the phone shows a red boot banner whenever the store is not durable.

**Android: clearing the app's *cache* never deletes the database.** App-private SQLite
survives cache clears, recents-swipes and reboots; only uninstall or "clear storage"
removes it. If clearing the cache seems to wipe your data, the app was never writing to
the database — that asymmetry is the fastest diagnosis there is.

**Never restore one device's snapshot over the other's database.** It looks safe because
snapshots hold the full history. It is not: the desktop is where spans, links and
revisions are made, they exist nowhere else, and a restore deletes them on every sync.
Use `tools/merge-snapshot.ts`.

---

## 6. What to do next

In order, and the first one is not code:

1. **Install it on the phone and use it for a week.** `docs/ANDROID.md`. The alarm's
   value is entirely empirical. `answered_at - end_ms` is the measurement: a median gap
   of minutes means the mechanism works; hours means the notification is being dismissed
   and the data is reconstruction wearing a timestamp. That is worth knowing before
   anything is built on top of it.
2. **Commit `android/`** after `npx cap add android` (run `npm run icons` first so the
   launcher PNGs are in it). The two alarm permissions now merge in from the v8
   notification plugin's own manifest — see `docs/ANDROID.md`.
3. **sql.js on the web path** — three lines in `bootstrap.ts`, so the desktop stops being
   memory-backed.
4. **The PWA** — manifest and service worker. §7 has claimed this since day one.
5. **Pinch zoom** on the timeline, if the phone ever needs it. This is also §12's "what is
   the first zoom gesture" resolved by necessity.
6. **The 2-way revision diff** — green/amber/red on the comparison table, a reserved
   palette never used for categories.

Phase 3 (layers 2 and 3, the graph with X-is-always-time, the light cone) and Phase 4 (the
apprentice model) are specified in `DESIGN.md` §§11 and unblocked but not started. Phase 4
cannot begin until a fine-tuning task is chosen — that decision is the real gate, and it
is why only the `raw` emitter exists.

---

## 7. Open questions, honestly stated

`DESIGN.md` §12 carries five. Three now have provisional answers that were taken by
default rather than by decision, and should be made explicit or reversed:

- **Sections on types or on nodes?** Both, currently: `NodeType.sections` exists and nodes
  carry free `attrs`.
- **Inbox ordering?** Recency only, by ULID, no extra column.
- **Two-device conflicts?** Last-write-wins per field, with every overwrite reported.
  Adequate for one person with two devices; not a general answer.

Still genuinely open: whether magnitude implies a default precision, and what the first
zoom gesture should be on the desktop.

New, from building it:

- `blocksInRange` merges materialized and projected on every call. At a decade of daily
  rules that is ~3,650 projections per query. Fine now; the fix when it stops being fine
  is a cache keyed on `(rule, range)`, not a different design.
- `SqliteStore` answers reads from an in-memory mirror rebuilt on open. Derived, not a
  second source of truth, and `verifyMirror()` asserts it — but it is the one file that
  has to change if the dataset ever outgrows memory.

---

## 8. Where everything is written down

| Question | File |
|---|---|
| What is this, and why is it like this | `docs/DESIGN.md` |
| What happened, when, and what got reversed | `docs/documentation/YYYY-MM-DD.md` |
| How to work in this repo, and the invariants | `CLAUDE.md` |
| The workbook format and its edge cases | `tools/xlsx-to-jsonl/SPEC.md` |
| Android, the APK, and syncing | `docs/ANDROID.md` |
| React and Vite, from zero | `docs/documentation/reference/react-and-vite.md` |
| Current state, traps, what is next | this file |

The reasoning for almost every non-obvious decision is in a docstring at the top of the
file that implements it, deliberately, so it sits next to the work rather than in a
document nobody opens.

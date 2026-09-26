# Spatium Temporis — Design

> **This document is a snapshot, not a contract.** The plan changes; when it does, edit
> this file. Git keeps every previous version, so no plan is ever lost — which is, after
> all, the point of the app.
>
> Last revised: 2026-09-26

---

## 1. What this actually is

Not a task manager. A place to put an entire mind in front of its own eyes.

The operative requirement, from which everything else follows:

> **The gap between a thought existing in my head and existing on screen must be near zero.**

If capture takes thirty seconds of deciding *where a thing goes*, the tool has failed and
will be abandoned inside a week. Every design decision below is downstream of that number.

The domains — books, workouts, quant, degrees, job applications, dreams, ideas, purchases,
finance, long-shot schemes — are **not** features. They are data the user creates at
runtime. No domain ever gets its own table, its own screen, or its own code path.

---

## 2. Core model

Four concepts. These are the only hardcoded ones, forever.

```
node    a thing.        id, type?, title, body?, status?, magnitude?, color?, attrs(json)
edge    a link.         from_node, to_node, relation, directed
span    an extent.      node_id, start?, start_precision, end?, end_precision
event   a change.       ts, node_id, kind, payload(json)   -- append-only
```

Everything above this line is user-defined at runtime: node types, section templates,
relation names, statuses, colors, categories. Adding "watches I want to buy" is a user
action, not a commit.

**Fixed tiny core, dynamic everything above it.** Fully-schemaless systems become mush;
fully-rigid ones become cages. This is the line between them.

### Schema sketch

Spec, not gospel — write the real migration yourself and change what's wrong.

```sql
CREATE TABLE nodes (
  id          TEXT PRIMARY KEY,          -- ULID, never autoincrement (see §5)
  type        TEXT,                      -- nullable! references node_types.name
  title       TEXT NOT NULL,
  body        TEXT,
  status      TEXT,                      -- user-defined vocabulary
  magnitude   TEXT,                      -- see §4
  color       TEXT,
  attrs       TEXT NOT NULL DEFAULT '{}',-- JSON; user-defined section fields
  created_at  INTEGER NOT NULL,          -- UTC epoch ms
  updated_at  INTEGER NOT NULL
);

CREATE TABLE spans (
  id              TEXT PRIMARY KEY,
  node_id         TEXT NOT NULL REFERENCES nodes(id),
  start_ms        INTEGER,               -- nullable: undated things are valid
  start_precision TEXT NOT NULL,         -- see §3
  end_ms          INTEGER,
  end_precision   TEXT NOT NULL
);

CREATE TABLE edges (
  id         TEXT PRIMARY KEY,
  from_node  TEXT NOT NULL REFERENCES nodes(id),
  to_node    TEXT NOT NULL REFERENCES nodes(id),
  relation   TEXT NOT NULL,              -- user-defined vocabulary
  created_at INTEGER NOT NULL
);

CREATE TABLE events (
  id      TEXT PRIMARY KEY,
  ts      INTEGER NOT NULL,
  node_id TEXT,
  kind    TEXT NOT NULL,                 -- created | retitled | span_changed | linked |
                                         -- unlinked | status_changed | note_added |
                                         -- split | abandoned | completed
  payload TEXT NOT NULL DEFAULT '{}'
);

-- recurrence (§9). A field on a node, not a separate kind of thing.
CREATE TABLE recurrences (
  id       TEXT PRIMARY KEY,
  node_id  TEXT NOT NULL REFERENCES nodes(id),
  kind     TEXT NOT NULL,             -- daily | weekly   (nothing else in Phase 1)
  weekdays TEXT,                      -- json array, 0-6, for kind=weekly
  from_ms  INTEGER NOT NULL,
  until_ms INTEGER                    -- null = open-ended
);

-- materialized past + exceptions. Future occurrences are NOT stored (§5.5).
CREATE TABLE occurrences (
  id         TEXT PRIMARY KEY,
  node_id    TEXT NOT NULL REFERENCES nodes(id),
  date_ms    INTEGER NOT NULL,        -- local midnight of the day it belongs to
  start_ms   INTEGER,
  end_ms     INTEGER,
  -- the adherence trio. Columns exist from Phase 1; their UI is Phase 2 (§9), so no
  -- migration is ever needed for them.
  outcome    TEXT,                    -- done | skipped | partial | moved | null (pending)
  reason     TEXT,                    -- why, when the outcome is a miss
  follow_up_node_id TEXT REFERENCES nodes(id),  -- what got planned in response
  note       TEXT,
  created_at INTEGER NOT NULL
);

-- revision markers (§9). Coalescing is computed from `events`; this table only stores
-- what coalescing can't derive: manual marks and labels (= named revision windows).
CREATE TABLE revisions (
  id     TEXT PRIMARY KEY,
  scope  TEXT NOT NULL,               -- which page/subtree this revision covers
  ts     INTEGER NOT NULL,
  label  TEXT,                        -- naming a revision names the window it opens
  manual INTEGER NOT NULL DEFAULT 0
);

-- user-defined vocabularies
CREATE TABLE node_types (name TEXT PRIMARY KEY, color TEXT, sections TEXT /*json*/);
```

`occurrences` and `spans` are *structural* concepts, like nodes and edges — they are not
domains, so they get tables. Workouts, books and job applications never will.

`attrs` as a JSON column rather than an EAV table: simpler, and `json_extract` in SQLite
handles querying well enough at personal scale. Revisit only if it actually hurts.

---

## 3. Precision — the field this project lives on

"3:00–4:30 gym today", "Stanford, sometime after postgrad", and "IIM or quants, undecided,
~2028" are all spans. Treating them identically is a lie the UI would tell constantly.

Every span endpoint carries a precision:

```
exact | hour | day | week | month | quarter | year | decade | someday
```

**Render precision honestly.** A 3pm meeting is a hard-edged bar. A decade-scale goal is a
soft gradient that fades out at both ends. The result: you can see at a glance which parts
of your life are committed and which are fog — without the app ever editorializing about
the ratio.

This is what lets the system survive plans that change constantly, instead of fighting them.

---

## 4. Magnitude — and why it *is* the zoom filter

Every node carries a magnitude, roughly:

```
micro | kilo | mega | giga | tera
```

A 20-minute task is micro. A decade-defining goal is tera.

> **Zoom level selects magnitude.**

- Zoomed to a **day** → micro + kilo. Today's actual work.
- Zoomed to a **month** → micro dissolves; kilo + mega render.
- Zoomed to **decades** → only tera. Four or five bright threads across a whole life.

This is not a nicety, it is what keeps the app usable. At this volume of ideas there will be
thousands of nodes within a year. Without magnitude filtering, every zoom level renders
everything, the view becomes noise, and the tool dies. With it, legibility at every scale is
automatic — one gesture moves through time *and* significance at once, with nothing to
configure.

It also means an unhinged tera-goal and a 20-minute errand coexist without competing for
attention. They never render at the same zoom.

---

## 5. Non-negotiables

Things that are cheap now and impossible to retrofit.

1. **Capture is never gated on classification.** `type`, `span`, and links are all nullable.
   A node with only a title and a timestamp is completely valid. The app must never ask
   "which project is this?" before accepting a thought.

2. **Nothing is deleted; nothing must earn its place.** A long-shot idea costs one row. No
   pruning prompts, no staleness nagging. Abandoned branches dim, they don't disappear.

3. **Append-only event log from commit one.** Current state is nearly worthless as training
   data for the eventual apprentice model (§11). The signal is in the *changes* — how plans
   get re-cut, what links to what, what gets abandoned and when. Keep normal mutable tables
   for reads and append to `events` on every write; ~20 lines, near-zero cost. **A year of
   unrecorded decision history cannot be recovered later.**

4. **Event payloads must be replayable.** `{kind: 'span_changed', node_id: 'x'}` records
   *nothing* — it says something moved, not what it was or what it became. Log
   `{before: {...}, after: {...}}` for every changed field. One write then buys revision
   replay (§9), undo, and an explicit delta for training. This failure is invisible until
   the day the data is needed and isn't there.

5. **Past occurrences are frozen; future ones are generated.** Editing a recurrence rule must
   never rewrite history (§9).

6. **ULIDs for every id, never autoincrement.** Two devices writing one dataset with integer
   ids collide the instant sync exists.

7. **UTC epoch ms stored, local time rendered, a real date library used.** Never hand-roll
   `+ 86400000`. DST and variable month lengths will cost a weekend otherwise.

8. **Export to a real file, on a shortcut, from Phase 1.** Full `.sqlite` + JSON snapshot.
   Backups matter more than the choice of storage engine.

---

## 6. The timeline: one transform, not eight views

Do **not** build a day view, a week view, a month view. That is eight implementations and
eight sets of bugs. Build one continuous transform:

```
scale = pixels per millisecond
x(t)  = (t - t_origin) * scale
```

Zooming changes one float. Everything else derives:

- **The current band is *derived* from `scale`**, not a mode that gets switched.
- A band is one table row: `{ minScale, maxScale, tickGenerator, labelFormat }`.
- Adding centuries later = adding a row. Adding seconds = adding a row. No new view code.
- Bands cross-fade on opacity across their overlap, so zoom feels continuous, not snapped.

Two traps:

- **Cull to the viewport.** Compute the first visible tick and step forward. Never iterate
  every day between 1900 and 2100 — that freezes the app the moment you zoom out.
- **Canvas 2D, not SVG or DOM.** Thousands of ticks and bars; DOM nodes will not survive it.

Registered bands in Phase 1: `day, week, month, year`. Hours and decades are a config
change, deliberately deferred so the mechanism gets proven first.

---

## 7. Platform

**One codebase, packaged three ways.**

| Stage | Package | Storage |
|---|---|---|
| Now | Web + PWA (installable, offline, phone home screen) | SQLite (wa-sqlite/sql.js) over IndexedDB/OPFS |
| Phase 2 | Capacitor → Android APK, sideloaded | Native SQLite file in app storage |
| Later, optional | Tauri desktop, or Play Store | Native SQLite file; Rust side can host local SLMs |

All storage access goes behind a `Store` interface so each step is a swap, not a rewrite.

Play Store is deferred on purpose: it exists to distribute to strangers, and this app has
one user. A PWA or a sideloaded APK already puts it on the device.

**Device split:**

> **Phone = capture. Desktop = structure and visualize. One database, two views.**

The 35/65 panels, drag-to-schedule, day-lanes and eventual graph are desktop-shaped and
unusable at phone size. The phone view is a text box and a list — about a day of work.

---

## 8. Pages

Each major section eventually gets its own page. Every page is a **projection over the one
store** — no page ever gets its own tables or its own copy of the data.

Phase 1 builds two:

**Main page — answers *when*.** A continuous time axis, one-off spans, zoom across scales.
The transform in §6.

**Scheduler page — answers *what does a typical week look like*.** Recurring commitments in
a repeating grid.

The scheduler is **the timeline folded on a cycle**. Week or month is a single parameter
(the fold cycle), not two implementations — same rule as §6. Occurrences generated by the
scheduler also render as bars on the main timeline; two projections, one dataset.

---

## 9. Revisions, adherence, recurrence

"Show me past revisions of my schedule" is **two** requirements with different machinery.
Both are cheap now and impossible to retrofit, so build both.

**1. What did I plan?** The schedule as written on a past date. Derived by replaying the
event log to a timestamp.

**2. What did I do?** Whether the Tuesday session actually happened. This *cannot* be derived
from edit history — it must be recorded as it occurs. Each occurrence carries an outcome
(`done | skipped | partial | moved`) plus an optional note.

The second one matters most downstream: **the gap between planned and enacted is the richest
possible training signal** for the apprentice model (§11). Almost nobody has that dataset
about themselves.

> **Phase split.** A schedule is a *framework* — a structure, versioned, comparatively
> stable. Enactment data is volatile and belongs to a different, more dynamic layer.
> Framework ships in Phase 1; enactment in Phase 2. The `outcome`, `reason` and
> `follow_up_node_id` columns exist in the Phase 1 schema regardless, so Phase 2 needs no
> migration. The only cost is that adherence for the weeks between phases is unrecoverable —
> bounded, and accepted.

### The end-of-block alarm is what makes adherence data exist

Phase 2, and it is infrastructure rather than convenience.

**Nobody fills in a week of outcomes on Sunday honestly.** They reconstruct, and
reconstruction is fiction — which would poison the single most valuable training signal in
the project. A prompt fired the moment a block ends, answered in two seconds, is the
difference between a real adherence record and an invented one.

So: an alarm at each occurrence's `end_ms`, offering the outcome in one tap. Green closes it.
Red asks two follow-ups — **why** (`reason`) and **what now**.

**"What now" creates a node.** Not a text field: a real node, with an edge back to the
occurrence that failed, stored as `follow_up_node_id`. That yields causal chains — *when this
gets missed, this is what happens next* — which is a far stronger training target than prose,
and it is precisely the work the graph exists to do.

### Recurrence — a deliberately tiny subset

Full recurrence (RRULE, "every 2nd Tuesday except holidays", timezone-shifted exceptions) is
a multi-week rabbit hole that has consumed entire calendar projects. Phase 1 supports:

- daily
- weekly on selected weekdays
- per-occurrence exceptions: skip this one, move this one

That covers ~90% of real personal scheduling. Keep field shapes RRULE-compatible so
expanding later isn't a rewrite, but **do not write a parser.**

### The rule that makes revisions honest

> **Past occurrences are materialized rows. Future occurrences are generated from the rule.**

Changing "gym Mon/Wed/Fri" to "gym Tue/Thu" must leave last month showing Mon/Wed/Fri —
that is what actually happened. If past occurrences were generated from the *current* rule,
editing the schedule would silently rewrite personal history and the revision view would be
a liar. Past is frozen fact; future is derived. This is invisible until it has already
corrupted months of data.

### Revision UI

Two ways in, same underlying replay:

**The "as of" scrubber.** The revision control *is* a time control — drag it back, the grid
replays the event log to that date and renders how it looked then, read-only and dimmed.
Same mental model as the main timeline.

**The revision strip.** Menu → Revisions opens a horizontally scrolling strip of revision
cards. Each card is a **live miniature of the actual week grid**, not a label — this is
*small multiples*, and it is the correct visualization for comparing many versions: identical
scale, repeated form, differences caught by eye without reading anything.

**Comparison — the spec-sheet model.** Comparing up to ~7 revisions works the way phone or
car models are compared: **columns are revisions, rows are slots, cells are contents.**
Unchanged rows dim; changed cells are emphasised. Horizontal scroll for more columns than
fit. "Mon 6am: gym / gym / — / run" reads straight across.

This beats small multiples *here* specifically because a schedule is discrete and
structured — small multiples suit continuous visual data, spec sheets suit enumerable slots.

Do **not** overlay multiple colored schedules on one grid. Readable at 2, mushy at 3, noise
at 7 — transparency stacks multiply and an overlap of three is indistinguishable from a dark
region. There is also a **color budget conflict**: hue already encodes category. The
comparison table differentiates by *column position*, leaving hue free.

A 2-way diff (added / removed / moved in a reserved green-amber-red palette, never used for
categories) is a fast follow on the same table.

### Every committed change is a revision — no coalescing

Nothing is hidden or merged. If a timing changes, a revision exists for it.

The one distinction that matters: **a revision is one *committed* change, not one input
frame.** A drag that lasts two seconds is a single revision on release, not 120 revisions at
60fps. That is not coalescing — intermediate drag frames were never changes in the first
place, and logging them would fill the strip with a record of a mouse moving.

### Blocks and contents — the bracket and what fills it

A schedule is a day's worth of **blocks**: start, end, category. "07:00–08:00 sleep",
"09:00–17:00 work". Each day's set differs. This is the framework layer — *what was planned* —
and it is fully computable without any enactment data, which is why it ships first.

**It needs no new tables.**

- **A block is an occurrence.** `occurrences` already is exactly this.
- **A category is a node type.** sleep / work / hobbies / college / travel are user-defined
  types created at runtime, never in code (§2).
- The block points at a node — *"Deep work: Arbor"*, *"Sleep"* — which carries type,
  magnitude, links and the rest.

#### Contents are nodes joined by edges, never a blob on the block

What actually happened inside a block — which book and how many pages, which route, that a
language app got used during the commute — is **separate from the bracket that contains it**.

The tempting shortcut is a `contents` JSON column on the occurrence. It is wrong, and one
example settles it: a language-practice session done during a travel block belongs to the
travel block *and* to the language-learning goal. Nested inside the block it is trapped
there, invisible to "how much of this have I actually done" — which is the question actually
worth asking.

So: **contents are ordinary nodes, linked to the block by edges.** One block holds many; one
content node sits in many contexts at once. That is the entire reason the graph exists.

Attributes live in `nodes.attrs` — no schema per category, ever. Soft structure comes from
**section templates** on the node type: a `reading-session` type *suggests* `{book, pages}`
without enforcing it. A form that knows what usually gets filled in, and nothing breaks when
something else does.

### Revision windows come free

"1st–10th = schedule 1, 11th–14th = schedule 2" needs no table and no extra concept.
**A revision window is the interval between two consecutive revisions.** Give a revision an
optional `label` and "exam prep" becomes a named window. One column, whole feature.

> **Naming.** "Period" is retired: it got used both for this interval *and* for a single
> scheduled slot, and one word with two meanings in one codebase is a bug factory. A slot is
> a **block** (§ Blocks and contents); the interval is a **revision window**.

---

## 10. Phase 1

**In:**
- Data layer: nodes / edges / spans / events, user-defined types and section templates
- **Main page:** timeline canvas, continuous zoom, four registered bands
  (`day → week → month → year`)
- Create a node with start/end + precision + magnitude + color
- Colored bars spanning their days
- **Inbox rail** — undated capture, one keystroke, lands with `span = null`; drag onto the
  timeline when it earns a date
- Click a day → tasks crossing it appear as horizontal lanes → select one to act on, or none
- **Scheduler page:** week/month fold, tiny recurrence subset, "as of" revision scrubber,
  revision strip, spec-sheet comparison table (~7 columns)
- Export to file on a shortcut — full `.sqlite` + JSON snapshot, generated on demand

**Out, deliberately (not forgotten):**
- Layers 2 and 3 — the day-lane interaction is the seed of these; the pattern is consistent
- Any graph view, 3D or otherwise
- Hour and decade/century bands (mechanism supports them; bands simply aren't registered)
- Edges between nodes — schema exists, no UI yet
- Any recurrence beyond daily / weekly-on-weekdays
- **Enactment / adherence data** — schedules are frameworks in Phase 1; what actually
  happened is the volatile layer and ships in Phase 2, along with the end-of-block alarm that
  captures it. `outcome` / `reason` / `follow_up_node_id` columns exist now anyway
- 2-way revision diff (comparison table first; diff is a fast follow)
- Training-format JSONL export and the xlsx → jsonl helper — the format is unknowable until
  fine-tuning is attempted, and it re-emits from history whenever it's finally written (§11)
- Anything AI

---

## 11. Deferred, but shaping decisions now

**The light cone.** The eventual main view. Past converges: fixed, collapsed, one history.
Future diverges: branching, possible, dim where uncommitted. Abandoned plan-branches stay in
the cone at low brightness. This is a *principled structure*, not decoration — it encodes
"no plan is ever lost" directly in the geometry, and the repo is named for it.

**On 3D: constrain one axis.** Free-rotating force-directed 3D graphs look extraordinary at
40 nodes and become unnavigable at 300 — occlusion, depth ambiguity, no stable spatial
memory. The fix:

> **X is *always* time. It never rotates away.**

Y and Z carry semantics (domain, layer, branch). Rotation around the time axis stays
meaningful and the mental map holds. It also makes the timeline and the graph *one space*
rather than two panels, because they share an axis.

The light-ray aesthetic — additive blending, bloom, thin bright lines on near-black — is 90%
achievable in 2D canvas. Real 3D waits until the data demands it.

**The apprentice model.** Local SLM trained on the event log, learning how this particular
mind plans, re-plans, links and abandons. Only Phase-1 obligation: **log events** (§5.3).
Build nothing else for it yet.

### Dataset export

**Generate on demand; never maintain a derived file.** An export kept in sync on every write
is a second source of truth that will drift, and it puts sync obligations on every write
path. The database already has everything — emit the file from a query, on a button or a
monthly job.

The decisive argument: **the right export format is unknowable until fine-tuning is actually
attempted, and it will be rewritten five or six times.** Generated on demand, a format change
costs one function and *every past month can be re-emitted in the new shape*. Incrementally
maintained, every previous export is frozen in an outgrown format — and the earliest months,
the ones that can never be recreated, are stuck worst.

**JSONL for training, not CSV.** Training pipelines expect one JSON object per line, and the
data is nested (a schedule has occurrences, which have outcomes and notes). Nesting does not
flatten into CSV without losing structure or exploding into denormalized repetition.

> **Implementation note (2026-09-26).** The app writes `.xlsx` itself — `src/export/zip.ts`
> is a ~140-line stored-entry zip writer and `src/export/xlsx.ts` emits the sheet XML with
> every cell as an inline string. No spreadsheet library is in the app bundle, and §3.1's
> "write every cell as text" holds by construction rather than by discipline: there is no
> code path that can emit a date cell. `exceljs` stays a devDependency of `tools/`, where
> it reads workbooks back.

**XLSX is the curation surface.** Export to `.xlsx` (which, unlike CSV, actually has sheets —
one per revision window), review and edit it by hand, then run a helper that converts the curated
sheets to training JSONL. That is a legitimate and useful loop: the spreadsheet is where a
human decides what's worth training on.

**Every exported row carries its `id`.** This is what makes the round trip work — the
converter rejoins on `id` to recover the nested structure that flattening to a grid
destroyed. Without it, xlsx → jsonl is lossy in exactly one direction, which is the worst
kind of lossy.

**The converter is being written before the exporter, on purpose.** Testing it requires
defining the workbook layout, which makes the converter the specification that
`src/export/xlsx.ts` must satisfy — a concrete target instead of an invented one, and a round
trip provable before either side touches a database. Layout, types, edge cases and build
order: `tools/xlsx-to-jsonl/SPEC.md`.

Only the *reader* half is knowable now. The training-record shape depends on which task gets
fine-tuned, which is undecided — so the tool ships a pluggable emitter interface with a
single `raw` emitter, and gains training emitters when there is a task.

**Local by default.** This dataset is an entire inner life; keeping processing on-device is
the point of the local-SLM plan in the first place.

---

## 12. Open questions

- Do sections/templates attach to node *types*, or to individual nodes, or both?
- Are magnitude and precision independent, or does magnitude imply a default precision?
- What is the very first zoom gesture — trackpad pinch, scroll, or a slider?
- Does the inbox have any ordering beyond recency?
- When two devices exist: last-write-wins, or something better?

Two of these now have a *provisional* answer in code, by default rather than by decision —
worth making explicit or reversing rather than leaving to drift:

- Sections/templates: `NodeType.sections` exists and nodes carry free `attrs`, so the
  current answer is "both".
- Inbox ordering: recency only, sorted by ULID with no extra column.

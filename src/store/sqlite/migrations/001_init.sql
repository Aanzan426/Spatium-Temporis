-- Initial schema. Written from docs/DESIGN.md §2.
--
-- Rules this file obeys, each of them a non-negotiable from §5:
--   - TEXT primary keys (ULIDs), never INTEGER AUTOINCREMENT              (§5.6)
--   - nodes.type and spans.start_ms/end_ms are NULLABLE — undated capture (§5.1)
--   - all timestamps INTEGER, UTC epoch ms                                (§5.7)
--   - occurrences.date_ms is LOCAL midnight of its day                    (§5.7)
--   - occurrences.outcome exists now though its UI is Phase 2             (§9)
--   - nothing is deleted; there is no DELETE path except edges            (§5.2)
--
-- `PRAGMA foreign_keys = ON` is set by SqliteStore on open, not here: a pragma in a
-- migration applies to the connection that happens to run it, which is a footgun.

CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT PRIMARY KEY,
  type        TEXT,                        -- nullable! references node_types.name
  title       TEXT NOT NULL,
  body        TEXT,
  status      TEXT,                        -- user-defined vocabulary
  magnitude   TEXT,                        -- micro | kilo | mega | giga | tera  (§4)
  color       TEXT,
  attrs       TEXT NOT NULL DEFAULT '{}',  -- JSON; user-defined section fields
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS spans (
  id              TEXT PRIMARY KEY,
  node_id         TEXT NOT NULL REFERENCES nodes(id),
  start_ms        INTEGER,                 -- nullable: undated things are valid
  start_precision TEXT NOT NULL,           -- exact … someday  (§3)
  end_ms          INTEGER,
  end_precision   TEXT NOT NULL
);

-- One span per node. Enforced here rather than in code, because `spans` is keyed by
-- node_id everywhere above this layer and a second row would silently shadow the first.
CREATE UNIQUE INDEX IF NOT EXISTS spans_node ON spans(node_id);

-- The range query the timeline runs on every frame's worth of panning. A plain index on
-- start_ms is enough at personal scale: the viewport filter is `end >= from AND start <
-- to`, SQLite seeks on start_ms and scans the rest.
CREATE INDEX IF NOT EXISTS spans_start ON spans(start_ms);
CREATE INDEX IF NOT EXISTS spans_end ON spans(end_ms);

CREATE TABLE IF NOT EXISTS edges (
  id         TEXT PRIMARY KEY,
  from_node  TEXT NOT NULL REFERENCES nodes(id),
  to_node    TEXT NOT NULL REFERENCES nodes(id),
  relation   TEXT NOT NULL,                -- user-defined vocabulary
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS edges_from ON edges(from_node);
CREATE INDEX IF NOT EXISTS edges_to ON edges(to_node);

-- Append-only (§5.3). There is no UPDATE or DELETE against this table anywhere in the
-- codebase, and there must never be one: a year of unrecorded decision history cannot
-- be recovered later.
CREATE TABLE IF NOT EXISTS events (
  id      TEXT PRIMARY KEY,
  ts      INTEGER NOT NULL,
  node_id TEXT,
  kind    TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'       -- JSON, carrying {before, after}  (§5.4)
);

-- Replay walks the log in ts order; the node index serves "history of this thing".
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_node_ts ON events(node_id, ts);

CREATE TABLE IF NOT EXISTS recurrences (
  id        TEXT PRIMARY KEY,
  node_id   TEXT NOT NULL REFERENCES nodes(id),
  kind      TEXT NOT NULL,                 -- daily | weekly  (nothing else in Phase 1)
  weekdays  TEXT,                          -- JSON array, 0-6, for kind=weekly
  from_ms   INTEGER NOT NULL,
  until_ms  INTEGER,                       -- null = open-ended
  start_min INTEGER,                       -- minutes past local midnight, or null
  end_min   INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS recurrences_node ON recurrences(node_id);

-- Materialized past + exceptions. Future occurrences are NOT stored (§5.5).
CREATE TABLE IF NOT EXISTS occurrences (
  id         TEXT PRIMARY KEY,
  node_id    TEXT NOT NULL REFERENCES nodes(id),
  date_ms    INTEGER NOT NULL,             -- LOCAL midnight of the day it belongs to
  start_ms   INTEGER,
  end_ms     INTEGER,
  -- the adherence trio. Columns exist from Phase 1; their UI is Phase 2 (§9), so no
  -- migration is ever needed for them.
  outcome    TEXT,                         -- done | skipped | partial | moved | null
  reason     TEXT,
  follow_up_node_id TEXT REFERENCES nodes(id),
  note       TEXT,
  created_at INTEGER NOT NULL
);

-- The merge in `blocksInRange` suppresses a projection wherever a real row exists for
-- the same (node_id, date_ms). This index is what makes that lookup free — and the
-- uniqueness is what makes `materializePast` idempotent rather than merely careful.
CREATE UNIQUE INDEX IF NOT EXISTS occurrences_node_date ON occurrences(node_id, date_ms);
CREATE INDEX IF NOT EXISTS occurrences_date ON occurrences(date_ms);

-- Revision markers (§9). Coalescing is computed from `events`; this table stores only
-- what coalescing cannot derive: manual marks and labels (= named revision windows).
CREATE TABLE IF NOT EXISTS revisions (
  id     TEXT PRIMARY KEY,
  scope  TEXT NOT NULL,                    -- which page/subtree this covers
  ts     INTEGER NOT NULL,
  label  TEXT,                             -- naming a revision names the window it opens
  manual INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS revisions_scope_ts ON revisions(scope, ts);

-- User-defined vocabularies. Adding "watches I want to buy" is an INSERT, not a commit.
CREATE TABLE IF NOT EXISTS node_types (
  name     TEXT PRIMARY KEY,
  color    TEXT,
  sections TEXT NOT NULL DEFAULT '[]'      -- JSON
);

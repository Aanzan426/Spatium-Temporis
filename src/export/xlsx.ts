/**
 * XLSX export — the human curation surface (§11).
 *
 * GENERATED ON DEMAND. Never a file kept in sync on every write: that is a second
 * source of truth that will drift, and it puts sync obligations on every write path.
 * The database already has everything.
 *
 * The decisive reason: the right export format is unknowable until fine-tuning is
 * actually attempted, and it will be rewritten five or six times. Generated on demand,
 * a format change costs one function and every past month can be re-emitted in the new
 * shape. Maintained incrementally, the earliest months — the ones that can never be
 * recreated — are stuck worst.
 *
 * One sheet per period (a period = the interval between two revisions).
 *
 * EVERY ROW CARRIES ITS `id`. That is what lets tools/xlsx-to-jsonl rejoin to the
 * database and recover the nested structure that flattening to a grid destroyed.
 * Without it the round trip is lossy in exactly one direction, which is the worst kind.
 */
export {}

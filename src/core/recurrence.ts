/**
 * Recurrence expansion — deliberately tiny (§9).
 *
 * Supported, and nothing more:
 *   - daily
 *   - weekly on selected weekdays
 *   - per-occurrence exceptions (skip this one, move this one)
 *
 * Keep field shapes RRULE-compatible so expanding later isn't a rewrite. Do NOT write
 * an RRULE parser. Full recurrence has consumed entire calendar projects.
 *
 * THE RULE THAT MAKES REVISIONS HONEST (§5.5):
 *   Past occurrences are materialized rows. Future occurrences are generated from the
 *   rule. Changing "gym Mon/Wed/Fri" to "gym Tue/Thu" must leave last month showing
 *   Mon/Wed/Fri — that is what actually happened. Generating the past from the current
 *   rule silently rewrites personal history.
 */
export {}

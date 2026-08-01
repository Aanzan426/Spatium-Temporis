/**
 * The domain model. No React, no DOM, no storage — pure types.
 *
 * Write these from the schema in `docs/DESIGN.md` §2. Doing it by hand is worth the
 * twenty minutes; the model is the whole project and it should live in your head.
 *
 * Node, Edge, Span, Event, Recurrence, Occurrence, Revision, NodeType.
 *
 * Non-negotiables that show up as types here:
 *   - `type`, `span` and links are all NULLABLE. A title + timestamp is a valid node.
 *   - Precision: exact | hour | day | week | month | quarter | year | decade | someday
 *   - Magnitude: micro | kilo | mega | giga | tera   (this is the zoom filter, §4)
 *   - All timestamps are UTC epoch milliseconds. Always. No Date objects in the model.
 */
export {}

/**
 * ULID generation. Never autoincrement — two devices writing one dataset with integer
 * ids collide the instant sync exists (§5.6).
 *
 * ULIDs are also lexicographically sortable by creation time, which is free ordering.
 */
export {}

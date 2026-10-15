# New and changed witnesses are placed into the existing alignment, not re-collated

Adding or refreshing a witness fits only that witness into the alignment as the scholar left it; collating every witness afresh happens only as a deliberate re-alignment, or when a change alters every witness's tokens.

- Re-collating mints new columns, so readings, arcs, hand alignment edits, and every decision tied to a unit were lost (`collation-state.svelte.ts`, `collation-adapter.ts`).
- Placement keeps prior alignment and regularization work by construction and is the lowest-effort path for the scholar.
- Re-alignment keeps a unit only when a new column holds exactly its old source tokens; anything less orphans loudly rather than being guessed.
- Rejected: re-collating and remapping columns as the default, because it can undo hand alignment.

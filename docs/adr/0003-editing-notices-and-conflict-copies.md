# Editing notices and conflict copies instead of locks or merging

Status: accepted

When two copies of a document's Current change independently — teammates in a team location, or one scholar offline on two devices — we warn with editing notices and turn any remaining collision into a conflict copy the scholar reconciles side by side (per verse for transcriptions, per variation unit for collations). Offline editing must never be blocked, and a collision in a collation is usually a scholarly disagreement that a human should settle.

## Considered Options

- **Locks / check-out** — Rejected: offline editing cannot take a lock, stale locks need expiry, and Drive and Dropbox offer no reliable atomic create-if-absent.
- **Automatic merging (CRDT)** — Rejected for now: a large change to file formats and editors, and it would silently merge editorial decisions that are genuine disagreements. File formats stay plain JSON so this remains possible later.

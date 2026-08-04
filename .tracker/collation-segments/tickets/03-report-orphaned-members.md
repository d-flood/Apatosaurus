# 03 — Report orphaned members

## What to build

Surface segment members that no longer resolve to any transcription, without stopping the collation.

A scholar's segment stores verse identifiers. Transcriptions get edited, re-imported, and deleted, and an identifier that resolved yesterday may resolve to nothing today. After slice 02 such a member silently contributes no witnesses — the collation runs, the apparatus is well-formed, and it is missing a witness for a reason nobody is told.

That silence is the failure this epic exists to remove, in its last remaining hiding place. A witness absent from an apparatus is indistinguishable from a witness that does not attest the passage, and the project's `non-attestation` / `omission` / `untranscribed witness` distinctions exist precisely so the app never asserts evidence it does not have. An unresolvable member must say so.

Demo: build a two-member segment, delete or re-import one of the contributing transcriptions, reopen the collation, and see the member reported as orphaned while the other member's witnesses still collate.

## Where to start

- The segment-aware gather entry point slice 02 added. This is where a member that resolves to zero transcriptions is already distinguishable; it just is not reported.
- `app/src/lib/client/collation/collation-runner-gather.spec.ts` — the same seam and mocking pattern slices 01 and 02 used.
- `CONTEXT.md:74` — the existing **orphaned decision** entry. Reuse that vocabulary and its shape of meaning: something naming a thing that no longer exists, surfaced for the scholar to resolve, never silently discarded. Do not invent a competing term.
- `app/src/lib/components/collation/SetupPhase.svelte` and `CollationWorkspace.svelte` — wherever the scholar will see the report.

## Contract

**Orphaned is reported, not fatal.** A member resolving to no transcription is reported and the collation proceeds with the members that did resolve. This is the opposite of the double-match rule from slice 02, which refuses to run — and the asymmetry is deliberate. A double match means the scholar's assertion is *wrong* and running would fabricate a reading. An orphan means the scholar's assertion is merely *stale*, and the remaining witnesses are still exactly what they claim to be.

**An orphaned member is never silently dropped from the segment.** It stays in the stored members list. The scholar removes it, or repairs the transcription; the app does not tidy up on their behalf. Silent removal would make the collation's own record of what the scholar asserted disagree with what they asserted.

**A segment whose members are all orphaned reports every one of them** and yields no witnesses. It does not fall back, and does not present as an ordinary empty result.

**The report distinguishes "not gathered" from "does not attest."** Whatever surface shows this must not let an orphaned member read as non-attestation. If the two would appear in the same list with the same styling, they are not distinguished.

**Reuse the orphan vocabulary; do not extend it.** This ticket adds no new concept to `CONTEXT.md`. `Collation segment` (slice 01) and the existing `orphaned decision` entry are sufficient.

## Out of scope

- Repairing, remapping, or suggesting replacements for an orphaned member. The scholar resolves it; the app reports it.
- Automatically removing orphaned members, on load or on save.
- Detecting orphans anywhere other than at gather time — no background scan, no index-change watcher, no staleness daemon.
- Changing the double-match behavior from slice 02.
- Any change to how non-attestation, omission, or untranscribed witnesses are computed or displayed. This slice must not touch that logic; it only must not be confusable with it.
- Renaming `Verse`-named symbols.

## Acceptance criteria

- [ ] Unit spec: a member matching no transcription is reported as orphaned, and the other members still gather their witnesses.
- [ ] Unit spec: an orphaned member remains in the segment's stored members after a run.
- [ ] Unit spec: a segment whose members all orphan reports each of them and returns no witnesses.
- [ ] Unit spec: an orphaned member does not appear in, and is not counted as, non-attestation.
- [ ] The scholar sees orphaned members reported in the collation UI, visually distinct from witnesses that do not attest.
- [ ] Slice 02's double-match behavior is unchanged: still an error, still refuses to run.
- [ ] `CONTEXT.md` gained no new entry in this slice.

Commands:

```sh
cd app && pnpm run check && pnpm run test:unit -- --run
```

Success = both exit 0.

## Blocked by

- 02 — multi-member segments and the segment-aware gather path.

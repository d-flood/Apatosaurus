# Alpha storage upgrade

Baseline: `c7d94eeb29f7f5761178bf862545e7096eebbc73`, deployed to
`https://alpha.apatosaurus.io/` on 2026-08-03. This supports that release's
canonical collation v2, working collation v2, and collation checkpoint v2.
It does not cover earlier database-only installations.

## On first startup

Before serving database requests, the worker validates each affected project's
canonical files and original hashes, converts its collations, and retains the
original project tree under
`apatosaurus/v1/upgrades/alpha-c7d94ee/<storage-slug>/original/` in OPFS.

A journal is written before changing project files. Publication is atomic per
file and writes the manifest last. If interrupted, startup resumes from the
journal before opening the editor; it refuses to overwrite a file that no
longer matches either the original or converted version. A separate completion
marker ensures the index is rebuilt even if the browser exits after publication.
Tombstoned collation primaries left by interrupted deletion are retained without
restoring the deleted collation or blocking startup.

Primary revision hashes and matching draft base hashes are updated together.
Revision IDs and parent checkpoint IDs remain unchanged. Stale drafts retain
their original base reference and are not promoted over newer work.
Backups containing stale collation drafts can be restored or imported as copies;
the drafts remain recoverable files and are reported as stale during index rebuild.
History files remain byte-for-byte immutable and are converted on read.
Transcription files, drafts, metadata, IIIF links, and checkpoint payloads retain
their existing v1 format.

## Editorial conversion

- The selected verse becomes the segment; alignment and witness source links stay intact.
- Saved reading groups retain their IDs, witness splits, order, and subreading relationships.
  A `preserveReadings` decision prevents regeneration from erasing these groups on reload.
  Their saved order survives subsequent saves until an explicit lemma choice reorders them.
- Directed stemma edges become prior-to-posterior arcs with the same IDs.
- Explicit `add`, `substitute`, and `transpose` classifications become custom reading types,
  added to the project vocabulary without replacing existing definitions.
- `orthographic` uses the bundled type; `omit` becomes `omission`.
  `unclassified` records no type decision. Automatic `ns` becomes proposed `nonsense`.
- Undirected edges are refused rather than assigned an invented direction. The alpha UI
  created directed edges; malformed or unsupported files stop conversion before publication.

Alpha project-backup imports use the same conversion and reference reconciliation.
The retained originals are local recovery data outside the synced project tree.

## Verification

From `app/`:

```sh
pnpm exec vitest run --project server src/lib/client/store/alpha-project-upgrade.spec.ts
pnpm exec playwright test -g 'alpha upgrade opens existing OPFS collation edits and preserves them after reload'
```

Coverage includes draft/history recovery, save/commit/rebuild, split readings,
classification and stemma preservation, interrupted publication, corrupt input,
stale drafts, backup import, and browser startup/reload against seeded OPFS files.

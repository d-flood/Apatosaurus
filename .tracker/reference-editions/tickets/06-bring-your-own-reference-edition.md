# 06 — Bring your own reference edition

## What to build

Let a scholar add their own reference edition file and seed from it exactly as they would from a bundled one. This is what makes the epic useful beyond Robinson-Pierpont and beyond the New Testament: the app will never bundle an edition for every corpus, and the editions scholars most want are often ones this project is not permitted to distribute.

Fills in the `user` branch of the catalog that ticket 04 left returning `[]`.

Demo: add a TEI edition file. It appears in the same list as Robinson-Pierpont, marked as yours. Seed from it. It is available in every project, and it survives a reload.

## Where to start

- The catalog accessor from ticket 04 and its `ReferenceEditionSource = 'bundled' | 'user'` discriminator. The merged list already exists; this ticket implements the second branch.
- `listUnits` / `extractRange` and the rejection rules from ticket 04 — already written and already tested. This ticket surfaces their failures to the user; it does not reimplement them.
- Storage layout: `app/src/lib/client/store/layout.ts`. `appFolder()` (line 172) returns the app-level directory that already holds `settings.json` (line 176) and `sync-targets.json` (line 180). Reference editions go alongside them.
- `app/src/lib/client/store/opfs-store.ts` for the store API, and `app/src/lib/client/store/memory-store-backend.spec-support.ts` for the in-memory backend the tests use.
- Storage architecture context: `.tracker/files-as-database/architecture.md`, section 4 (canonical file layout).
- Prior art for app-level persisted config: `app/src/lib/client/store/sync-targets.ts` and `sync-targets.spec.ts`.

## Contract

**Storage is app-level, not project-level.** User-supplied editions live under the app folder, shared across all projects and stored once.

**They are deliberately excluded from per-project archives.** This is not an oversight and must not be "fixed". Project archives get handed to colleagues. An edition inside a project zip silently redistributes whatever the scholar seeded from — which, for a scholar who supplied their own licensed edition, rebuilds the exact redistribution problem ticket 01 removed from this repository, one user at a time. Inclusion in the **whole-account** export is ticket 08.

**Registration rules**, all of which surface the source contract from ticket 04:

- Non-XML or non-TEI input is rejected with **the parse error surfaced**, not swallowed into a generic failure.
- A file with **no milestones at all** is rejected with a message naming what is missing — something a scholar can act on, e.g. that a reference edition needs addressable divisions.
- A file with **repeated milestone references** is accepted.
- **Failed registration leaves nothing behind.** No partial catalog entry, no orphaned file in the store.
- **Re-registration of the same edition is detected**, using an identity rule of its own. Do **not** reuse `buildTranscriptionDuplicateKey` (`app/src/lib/igntp/duplicate-key.ts`) — it keys on siglum-or-title and is built for witnesses, which editions are not.

**Attribution is captured at registration.** Take it from the file's own `<availability>` statement when present; prompt the user when absent. It is displayed in the picker and used by ticket 07.

**Missing-edition empty state.** A project restored on a second machine will reference an edition that machine does not have. Attribution still works — the transcription stores the edition's *identity*, not the file. Re-seeding must prompt the scholar to supply the file again, with a named, unalarming empty state. Phrased wrongly this reads as data loss; phrase it as "this edition is not on this device."

**Parsing stays off the main thread**, through the same path as bundled editions.

## Out of scope

- Including editions in the whole-account export. Ticket 08.
- Rendering editions-used into the exported TEI header. Ticket 07.
- Any change to per-project zip export or import.
- Editing or re-versioning a registered edition. Adding and removing is enough.
- Fetching editions from a URL.
- Changing `listUnits`, `extractRange`, or the rejection rules themselves — only their presentation.
- Modifying the IGNTP catalog or import panel.

## Acceptance criteria

- [ ] Store spec against the in-memory backend: a registered edition persists under the app folder and is readable after a fresh store instance.
- [ ] Store spec: the same edition appears when reading from two different projects.
- [ ] Store spec: a per-project archive of a project whose transcriptions were seeded from a user edition does **not** contain the edition file.
- [ ] Spec: registering a non-XML file fails with the underlying parse error present in the message, and leaves no catalog entry and no stored file.
- [ ] Spec: registering a TEI file with no milestones fails with a message naming the missing divisions, and leaves nothing behind.
- [ ] Spec: registering a TEI file with a repeated milestone reference succeeds.
- [ ] Spec: registering the same edition twice is detected and reported.
- [ ] Browser spec: a registered edition appears in the same picker list as the bundled one, and seeding from it inserts unconfirmed text.
- [ ] Browser or component spec: a transcription referencing an edition absent from this device shows the missing-edition state and offers to supply the file.
- [ ] Any new phosphor icon is added to `optimizeDeps.include` in `app/vite.config.ts`.

Commands:

```sh
cd app && pnpm run check && pnpm run test:unit -- --run && pnpm run test:e2e
```

Success = all exit 0.

## Blocked by

- 04 — the catalog's `user` branch, the source contract, and the picker.

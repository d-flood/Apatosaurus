# Future Work

- **Collation punctuation:** define and test how punctuation participates in tokenization, regularization,
  alignment, and the `ignorePunctuation` setting.
- **Collation undo and redo:** add reversible editing for post-alignment collation workflows without creating
  another persisted representation of the canonical collation document.
- **Image caching:** investigate explicit offline caching for transcription images, including direct image URLs
  and IIIF tiles, with visible storage use and eviction controls.

## From the 2026-08-11 architecture review

Findings not yet scheduled. Each is evidenced against a specific site so it can be re-verified rather than
re-derived; the two that were scheduled became `readings-and-stemma-phases` ticket `02` and
`files-as-database` ticket `24`.

- **The index is authoritative on write:** files are canonical on read but derived from SQLite on write.
  `transcription-files.ts` computes the hash that seals the canonical file from `loadProjectTranscriptionSnapshot`,
  which is pure SQL, and `project-files.ts` builds `project.json` head lists from index columns — so a stale index
  row silently drops an entity from the manifest and the rebuild reproduces the loss. The commit path should read
  the working file and hash once; the collation path already does, the transcription path does not (it hashes
  twice). Also here: `collation_artifacts` is deleted on rebuild and never repopulated, and live writes give
  projection rows `crypto.randomUUID()` ids while the rebuild assigns deterministic ones, so rebuild is not
  idempotent with respect to index contents.
- **The index seam is a four-place edit:** adding one repository function means eight hand edits across
  `db/rpc.ts`, `db/db.worker.ts`, and `db/client.ts` — 86 map entries, 93 dispatch arms, 93 wrappers with no logic
  in them, over 139 repository functions. Of 23 commits touching `rpc.ts` in the last six months, 21 also touched
  the other two; they are the repository's three highest-churn files. A forgotten dispatch arm returns `null`
  rather than throwing, and eleven of `client.ts`'s exports have no caller at all. Derive the seam from one
  registry keyed by the message literal, and give the 44 hand-written invalidation domains a table.
- **Durability has no module:** `capabilities.ts`, `sync/backup-status.ts`, `sync/backup-health.ts`, and
  `sync/project-backup-health-state.ts` each answer one facet of "is this scholar's work safe?", and no module
  answers the question — so `routes/data/+page.svelte` and `ProjectBackupPanel.svelte` each assemble it again, with
  8 and 7 `vi.mock` calls respectively (15 of the repository's 36). `ProjectBackupPanel` reimplements status
  precedence that `deriveLocalSyncUiState` was written to own and which has no callers.
- **Editing behaviour is component-private:** roughly 42% of the transcription editor's non-schema behaviour lives
  inside `TranscriptionEditor.svelte` and is reachable only by mounting Svelte and driving the DOM — including 189
  lines of scroll geometry with no coverage and a 107-line reentrant autosave queue whose retry path is untested.
  Four production-shaped harness components (815 lines in `src/lib`) exist only to give tests a way in, each
  re-implementing handlers that already exist twice. The component also imports `db/client` directly and owns
  serialization format, timestamps, and retry. `formworkConcepts.ts` — 533 lines, one export, an 89-line plain node
  spec — is the shape the rest of the area is not.
- **Running a collation has no module:** the six-step run sequence is caller knowledge, written out in both
  `AlignmentGrid.svelte` and `RegularizationPhase.svelte`, and there are zero `.svelte.spec.ts` files anywhere
  under `components/collation/` or `routes/collation/`, so neither copy is tested. The ordering contract leaks too:
  `addRule` does not refresh derived input but `setLowercase` does, so seven call sites must know which setters
  need a manual `refreshCollationInput()`. Related and cheap: `AlignmentGrid.svelte` redefines `isVariationColumn`
  over normalized text only, so its highlighting disagrees with the units the readings phase and the SQL projection
  build — and with its own sibling `AlignmentVariationUnitsView.svelte`, which imports the real one. Establishing a
  collation component-test seam gates `readings-and-stemma-phases` tickets 07–09, which are the accessibility work.
- **The line-content node set is written twice:** `transcriptionEditorSchema.ts` and `transcriptionEditorStructure.ts`
  each hold the same fifteen node names in the same order, with no import between them — one drives the `line`
  content expression, the other drives structure repair on every paste and load. Add a node type and forget the
  second list and repair strips it out of every document it touches. The same duplication runs across the TEI seam:
  `pm-adapter.ts` holds four parallel dispatch tables over one node set, and the schema's correction-preview
  serializer duplicates `plain-text.ts` branch for branch.
- **The path grammar has no reader:** `store/layout.ts` exports 44 path constructors and no parser, so
  `formats/index.ts` (8 regexes), `opfs-store.ts`, `index-rebuild.ts`, `sync-manager.ts`, and `project-zip-import.ts`
  each re-derive the grammar — including the primary → `.tei.xml` sibling rule, written out four separate times as a
  string replacement. Add the parse direction: one function from path to a described location.
- **Indirection that looks like layering:** `iiif/storage.ts` is a single re-export line; `db/repositories/iiif-files.ts`
  is 162 lines of ten identical wrappers; `sync/canonical-json.ts` and `sync/cloud-files.ts` are one line each. The
  last two invert the dependency graph — `store/envelope.ts` reaches its own directory's hashing *through* `sync/`,
  and `db/repositories/` does the same — so `store` and `db` appear to depend on `sync` while `sync` depends on both.
  Delete the pure forwarders. `collation/project-collation.ts` is the exception and should be deepened rather than
  deleted: 23 call sites across the whole app already use it, so the seam is right, but it is mostly pass-through,
  it is filed under `collation/` while serving navigation and project pages, and `collation-state.svelte.ts` bypasses
  it to import the same names from `db/client`.

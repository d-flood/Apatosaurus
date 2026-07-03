# Phase 03: Canonical File Formats

Status: Not Started
Depends on: Phase 02
Architecture reference: `architecture.md` section 5

## Goal

Promote the existing cloud file formats (`app/src/lib/client/sync/cloud-files.ts`) to the canonical document formats, registered with the migrate-on-read framework. Fold IIIF data into the transcription document. Define working-state formats. Wire up derived TEI serialization for both transcriptions and collations.

## Scope

1. Create `app/src/lib/client/store/formats/` with one module per format id from `architecture.md` section 5:
   - `project-manifest.ts` (from `ProjectCloudFile`)
   - `project-transcription.ts` (from `ProjectTranscriptionCloudFile`) - now includes IIIF sources, page-canvas links, and canvas annotations as document fields, since the checkpoint payload already carries them
   - `collation.ts` (from `CollationCloudFile` / `SerializedCollation`)
   - `checkpoint-transcription.ts`, `checkpoint-collation.ts` (from history file shapes)
   - `tombstone.ts` (from `TombstoneCloudFile`)
   - `working-transcription.ts`, `working-collation.ts` (new; local-only autosave shape: same payload as committed formats plus draft metadata, no commit fields)
2. Each format module exports: TypeScript types, a shape validator, `CURRENT_VERSION`, upgraders array (empty at greenfield), and fixtures.
3. Since this is greenfield, set every format to `schema_version: 1` in the new envelope, even where shapes changed from the old cloud files. Retain one old-shape fixture per changed format to prove the validators reject stale shapes cleanly (quarantine, not crash).
4. `cloud-files.ts` becomes a thin re-export/adapter over the format modules until Phase 7 reworks sync; parsing/serialization logic must live in exactly one place after this phase.
5. Derived TEI:
   - Transcription: reuse `app/src/lib/tei/tei-exporter.ts` / `serializeTei` to produce `<id>.tei.xml` from a committed document. Pure function: `transcriptionDocumentToTei(doc): string`.
   - Collation: new serializer `collationDocumentToTei(doc): string` producing a TEI parallel-segmentation apparatus (`<app>`/`<lem>`/`<rdg>` with witness sigla) from `collation_document_v1`. Keep it minimal and standards-conformant; consult `example_collation.xml` at repo root and `NT_Manuscripts_TEI_Schema/` for target shape. Mark explicitly as derived output, not a parser target.
6. Round-trip and property tests:
   - seal -> serialize -> read -> deep-equal for every format
   - hash stability: same payload always yields the same `content_hash` (canonical JSON)
   - TEI serializers produce well-formed XML for representative fixtures (parse with `DOMParser`)

## Non-Goals

- No writes to OPFS from feature code yet (Phase 5).
- No TEI *parsing* of collation apparatus; TEI apparatus is one-way derived output.
- No SQLite schema changes (Phase 4).

## Design Notes

- The IIIF fold-in is the one real shape change. Source rows come from `iiif_manifest_sources`, `transcription_page_canvas_links`, `iiif_canvas_annotations` (see `repositories/iiif.ts`); the checkpoint payload already snapshots them, so mirror that structure in the primary document rather than inventing a new one.
- Witness pinning in the collation format (`source_revision_id`, `source_content_hash` per witness) is retained verbatim; it is what makes duplication-with-lineage auditable.
- Lineage fields (`origin_project_id`, `origin_transcription_id`, `origin_revision_id`, `origin_content_hash`) are retained verbatim in the transcription format.
- Keep validators strict on unknown top-level fields rejected vs ignored: decide once (recommendation: ignore unknown fields to ease forward compatibility, validate known fields strictly) and document in Notes.

## Checklist

- [ ] All eight format modules with types, validators, versions, fixtures
- [ ] Formats registered with migrate-on-read registry
- [ ] `cloud-files.ts` delegated to format modules; single source of parsing truth
- [ ] IIIF data included in project-transcription format
- [ ] `transcriptionDocumentToTei` wired and tested
- [ ] `collationDocumentToTei` implemented and tested against fixtures
- [ ] Round-trip + hash-stability tests pass for every format
- [ ] `bun run check` and `bun run test:unit -- --run` pass

## Completion Criteria

Every canonical format is defined once, validated, fixture-tested, and registered. Existing sync tests still pass through the adapter. TEI derivation exists for both entity types as pure, tested functions.

## Verification

```bash
cd app
bun run test:unit -- --run src/lib/client/store src/lib/client/sync/cloud-files.spec.ts
bun run check
```

## Notes

| Date | Note |
| --- | --- |

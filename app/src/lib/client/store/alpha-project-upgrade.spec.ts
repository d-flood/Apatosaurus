import { describe, it, expect } from 'vitest';
import alpha from './formats/fixtures/alpha-collation-v2.json';
import { upgradeAlphaProjects, markAlphaUpgradesIndexed } from './alpha-project-upgrade';
import { MemoryStoreBackend } from './memory-store-backend.spec-support';
import { hashCanonicalPayload } from './canonical-json';
import { openEnvelope, sealDocument, serializeSealedDocument, type JsonObject } from './envelope';
import { readTextFile, writeTextFileAtomic } from './opfs-store';
import {
	COLLATION_FORMAT,
	WORKING_COLLATION_FORMAT,
	COLLATION_CHECKPOINT_FORMAT,
	PROJECT_MANIFEST_FORMAT,
	PROJECT_MANIFEST_FIXTURE,
	PROJECT_TRANSCRIPTION_FIXTURE,
	PROJECT_TRANSCRIPTION_FORMAT,
	WORKING_TRANSCRIPTION_FORMAT,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	TRANSCRIPTION_CHECKPOINT_FIXTURE,
	TOMBSTONE_FORMAT,
	TOMBSTONE_FIXTURE,
	projectTranscriptionPayloadToSnapshot,
	readCanonicalDocument,
	type CollationPayload,
	type WorkingCollationPayload,
} from './formats';
import {
	hydrateCollationDocument,
	buildCollationDocument,
} from '$lib/client/collation/collation-document';
import { deserializeAlignmentColumns } from '$lib/client/collation/alignment-snapshot';
import { applyDecisions } from '$lib/client/collation/collation-decisions';
import { joinStorePath, APP_STORE_ROOT } from './layout';
import {
	buildApparatusTeiExportInput,
	exportCollationDocumentTei,
} from '$lib/client/collation/collation-tei';
import { createLocalDbTestHarness } from '$lib/client/db/test-harness';
import { createProject } from '$lib/client/db/repositories/projects';
import { rebuildIndexFromStore } from '$lib/client/db/repositories/index-rebuild';
import {
	loadCollationWithWorkingFile,
	createCommittedCollationCheckpointWithFiles,
	saveWorkingCollationArtifact,
} from '$lib/client/db/repositories/collation-files';
import { importProjectFileTree, importProjectZip } from '$lib/client/sync/project-zip-import';
import { exportProjectZip } from '$lib/client/sync/project-zip-export';

async function fixture(source = structuredClone(alpha), deleted = false) {
	const backend = new MemoryStoreBackend();
	const options = { backend };
	const { created_at, updated_at, ...content } = source;
	const contentHash = await hashCanonicalPayload(content);
	const revision = {
		id: 'cp-alpha',
		content_hash: contentHash,
		created_at,
		author_name: 'Alpha editor',
	};
	const transcription = structuredClone(PROJECT_TRANSCRIPTION_FIXTURE);
	transcription.content_json = {
		type: 'transcriptionDocument',
		pages: [
			{
				type: 'page',
				id: 'page-alpha',
				columns: [
					{
						type: 'column',
						number: 1,
						lines: [
							{
								type: 'line',
								number: 1,
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'εν αρχη' },
								],
							},
						],
					},
				],
			},
		],
	};
	const txSnapshot = projectTranscriptionPayloadToSnapshot(transcription);
	transcription.current_revision.content_hash = await hashCanonicalPayload(txSnapshot);
	const { current_revision: txRevision, ...txWorking } = transcription;
	const txCheckpoint = {
		...TRANSCRIPTION_CHECKPOINT_FIXTURE,
		payload: txSnapshot as unknown as JsonObject,
		payload_content_hash: txRevision.content_hash,
	};
	const tombstone = {
		...TOMBSTONE_FIXTURE,
		project_id: alpha.project_id,
		entity_type: 'collation',
		entity_id: alpha.id,
		cloud_path: `collations/${alpha.id}.json`,
		deletion_revision_id: revision.id,
	};
	const manifest = {
		...structuredClone(PROJECT_MANIFEST_FIXTURE),
		id: alpha.project_id,
		name: 'Alpha project',
		transcriptions: [
			{
				...PROJECT_MANIFEST_FIXTURE.transcriptions[0],
				current_revision: { id: txRevision.id, content_hash: txRevision.content_hash },
			},
		],
		collations: [
			{
				collation_id: alpha.id,
				title: alpha.title,
				verse_identifier: alpha.verse_identifier,
				primary_path: `collations/${alpha.id}.json`,
				current_revision: { id: revision.id, content_hash: contentHash },
			},
		],
	};
	if (deleted) {
		manifest.collations = [];
		manifest.tombstones = [
			{
				tombstone_id: tombstone.id,
				entity_type: tombstone.entity_type,
				entity_id: tombstone.entity_id,
				deletion_revision_id: tombstone.deletion_revision_id,
				content_hash: await hashCanonicalPayload(tombstone),
				primary_path: `tombstones/collation--${alpha.id}.json`,
				deleted_at: tombstone.deleted_at,
			},
		];
	}
	manifest.manifest_content_hash = await hashCanonicalPayload({
		project_id: manifest.id,
		transcriptions: manifest.transcriptions,
		collations: manifest.collations,
		tombstones: manifest.tombstones,
	});
	const entries = [
		['project.json', PROJECT_MANIFEST_FORMAT, 2, manifest],
		...(deleted
			? [[`tombstones/collation--${alpha.id}.json`, TOMBSTONE_FORMAT, 1, tombstone] as const]
			: []),
		[
			`collations/${alpha.id}.json`,
			COLLATION_FORMAT,
			2,
			{ ...content, created_at, updated_at, current_revision: revision },
		],
		[
			`collations/${alpha.id}.working.json`,
			WORKING_COLLATION_FORMAT,
			2,
			{
				...content,
				notes: 'Unsaved editorial work',
				created_at,
				updated_at,
				draft: {
					base_revision_id: revision.id,
					base_content_hash: contentHash,
					saved_at: updated_at,
					author_name: 'Alpha editor',
				},
			},
		],
		[
			`history/collations/${alpha.id}/${revision.id}.json`,
			COLLATION_CHECKPOINT_FORMAT,
			2,
			{
				checkpoint_id: revision.id,
				entity_type: 'collation',
				entity_id: alpha.id,
				parent_checkpoint_id: null,
				payload_content_hash: contentHash,
				payload: content,
				commit_message: 'Alpha work',
				author_name: 'Alpha editor',
				created_at,
			},
		],
		['transcriptions/pt-1.json', PROJECT_TRANSCRIPTION_FORMAT, 1, transcription],
		[
			'transcriptions/pt-1.working.json',
			WORKING_TRANSCRIPTION_FORMAT,
			1,
			{
				...txWorking,
				description: 'Transcription draft',
				draft: {
					base_revision_id: txRevision.id,
					base_content_hash: txRevision.content_hash,
					saved_at: updated_at,
					author_name: 'Alpha editor',
				},
			},
		],
		[
			'history/transcriptions/pt-1/tx-cp-1.json',
			TRANSCRIPTION_CHECKPOINT_FORMAT,
			1,
			txCheckpoint,
		],
	] as const;
	const files = [];
	for (const [path, format, version, payload] of entries) {
		const text = serializeSealedDocument(
			await sealDocument(format, version, payload as unknown as JsonObject)
		);
		await writeTextFileAtomic(`projects/alpha/${path}`, text, options);
		files.push({ path, content: text });
	}
	return { backend, options, files };
}

describe('alpha project upgrade', () => {
	it('keeps manual alpha reading order through load, save and reload until a lemma is chosen', async () => {
		const source = structuredClone(alpha);
		const readings = source.document.apparatus.units[0].readings;
		readings[0].order = 1;
		readings[0].label = 'b';
		readings[1].order = 0;
		readings[1].label = 'a';
		readings[2].label = 'a1';
		const { options } = await fixture(source);
		await upgradeAlphaProjects(options);
		const harness = createLocalDbTestHarness();
		try {
			await rebuildIndexFromStore(harness.db, options);
			const path = `projects/alpha/collations/${alpha.id}.working.json`;
			for (const lemmaReadingId of [undefined, undefined, 'r-a']) {
				const working = await readCanonicalDocument<WorkingCollationPayload>(
					WORKING_COLLATION_FORMAT,
					await readTextFile(path, options)
				);
				if (!working.ok) throw new Error('Draft unreadable');
				const hydrated = hydrateCollationDocument(working.payload.document);
				const [unitId, decisions] = hydrated.unitDecisions[0];
				if (lemmaReadingId) decisions.lemmaReadingId = lemmaReadingId;
				const view = applyDecisions(hydrated.classifiedReadings[0][1], decisions, {
					baseWitnessId: 'A',
				});
				const expected = lemmaReadingId
					? [
							['r-a', 0, 'a'],
							['r-b', 1, 'b'],
							['split-c', 0, 'b1'],
						]
					: [
							['r-b', 0, 'a'],
							['r-a', 1, 'b'],
							['split-c', 0, 'a1'],
						];
				expect(
					view.readings.map(reading => [reading.id, reading.order, reading.label])
				).toEqual(expected);
				const saved = buildCollationDocument({
					...hydrated,
					alignmentColumns: deserializeAlignmentColumns(hydrated.alignmentColumns),
					classifiedReadings: new Map(hydrated.classifiedReadings),
					unitDecisions: new Map([[unitId, decisions]]),
					readingArcs: new Map(hydrated.readingArcs),
				});
				await saveWorkingCollationArtifact(
					harness.db,
					{
						collationId: alpha.id,
						artifactType: 'collation_document_v1',
						payload: JSON.stringify(saved),
					},
					options
				);
				const reloaded = await readCanonicalDocument<WorkingCollationPayload>(
					WORKING_COLLATION_FORMAT,
					await readTextFile(path, options)
				);
				if (!reloaded.ok) throw new Error('Saved draft unreadable');
				expect(
					hydrateCollationDocument(
						reloaded.payload.document
					).classifiedReadings[0][1].map(reading => [
						reading.id,
						reading.order,
						reading.label,
					])
				).toEqual(expected);
			}
		} finally {
			await harness.destroy();
		}
	});

	it('retains tombstoned leftovers without blocking other project data or resurrecting deleted work', async () => {
		const { options, files } = await fixture(structuredClone(alpha), true);
		expect(await upgradeAlphaProjects(options)).toBe(true);
		for (const file of files) {
			expect(
				await readTextFile(`upgrades/alpha-c7d94ee/alpha/original/${file.path}`, options)
			).toBe(file.content);
			if (file.path.startsWith('collations/'))
				expect(await readTextFile(`projects/alpha/${file.path}`, options)).toBe(
					file.content
				);
		}
		const harness = createLocalDbTestHarness();
		try {
			expect(await rebuildIndexFromStore(harness.db, options)).toMatchObject({
				projectsRestored: 1,
				transcriptionsRestored: 1,
				collationsRestored: 0,
				tombstonesRestored: 1,
				quarantinedFiles: [],
			});
			await markAlphaUpgradesIndexed(options);
			expect(await upgradeAlphaProjects(options)).toBe(false);
		} finally {
			await harness.destroy();
		}
	});

	it('preserves drafts, history, witness splits, classifications and source arcs through rebuild, save and commit', async () => {
		const { options, files } = await fixture();
		expect(await upgradeAlphaProjects(options)).toBe(true);
		for (const file of files)
			expect(
				await readTextFile(`upgrades/alpha-c7d94ee/alpha/original/${file.path}`, options)
			).toBe(file.content);
		for (const file of files.filter(
			file => file.path.startsWith('transcriptions/') || file.path.startsWith('history/')
		))
			expect(await readTextFile(`projects/alpha/${file.path}`, options)).toBe(file.content);
		const primary = await readCanonicalDocument<CollationPayload>(
			COLLATION_FORMAT,
			await readTextFile(`projects/alpha/collations/${alpha.id}.json`, options)
		);
		const working = await readCanonicalDocument<WorkingCollationPayload>(
			WORKING_COLLATION_FORMAT,
			await readTextFile(`projects/alpha/collations/${alpha.id}.working.json`, options)
		);
		if (!primary.ok || !working.ok) throw new Error('Upgrade unreadable');
		expect(working.payload.draft.base_content_hash).toBe(
			primary.payload.current_revision.content_hash
		);
		expect(working.payload.notes).toBe('Unsaved editorial work');
		const hydrated = hydrateCollationDocument(working.payload.document);
		expect(
			hydrated.classifiedReadings[0][1].map(reading => [reading.id, reading.witnessIds])
		).toEqual([
			['r-a', ['A']],
			['r-b', ['B']],
			['split-c', ['C']],
		]);
		expect(hydrated.unitDecisions[0][1].readingType).toEqual({
			'r-b': 'substitute',
			'split-c': 'orthographic',
		});
		expect(hydrated.readingArcs[0][1]).toEqual([
			{ id: 'edge-alpha', priorReadingId: 'r-a', posteriorReadingId: 'r-b' },
		]);
		const saved = buildCollationDocument({
			...hydrated,
			alignmentColumns: deserializeAlignmentColumns(hydrated.alignmentColumns),
			classifiedReadings: new Map(hydrated.classifiedReadings),
			unitDecisions: new Map(hydrated.unitDecisions),
			readingArcs: new Map(hydrated.readingArcs),
		});
		expect(hydrateCollationDocument(saved).classifiedReadings[0][1]).toHaveLength(3);
		expect(
			buildApparatusTeiExportInput(saved).units.get('unit:column-alpha')!.view
				.orphanedDecisions
		).toEqual([]);
		expect(exportCollationDocumentTei(saved)).toContain('type="substitute"');
		const harness = createLocalDbTestHarness();
		try {
			const report = await rebuildIndexFromStore(harness.db, options);
			expect(report).toMatchObject({
				projectsRestored: 1,
				transcriptionsRestored: 1,
				collationsRestored: 1,
				collationCheckpointsRestored: 1,
				transcriptionCheckpointsRestored: 1,
				quarantinedFiles: [],
				orphanedFiles: [],
			});
			expect(
				await harness.db
					.selectFrom('transcriptions')
					.select('description')
					.executeTakeFirst()
			).toMatchObject({ description: 'Transcription draft' });
			const transcription = await harness.db
				.selectFrom('transcriptions')
				.select('content_json')
				.executeTakeFirstOrThrow();
			expect(transcription.content_json).toContain('εν αρχη');
			const project = await harness.db
				.selectFrom('projects')
				.select('collation_settings')
				.executeTakeFirstOrThrow();
			expect(JSON.parse(project.collation_settings).readingTypes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: 'substitute', selectable: true }),
				])
			);
			expect(
				await loadCollationWithWorkingFile(harness.db, alpha.id, options)
			).not.toBeNull();
			await saveWorkingCollationArtifact(
				harness.db,
				{
					collationId: alpha.id,
					artifactType: 'collation_document_v1',
					payload: JSON.stringify(saved),
				},
				options
			);
			await createCommittedCollationCheckpointWithFiles(
				harness.db,
				{ collationId: alpha.id, checkpointId: 'cp-new' },
				options
			);
			expect(
				(await rebuildIndexFromStore(harness.db, options)).collationCheckpointsRestored
			).toBe(2);
			await markAlphaUpgradesIndexed(options);
			expect(await upgradeAlphaProjects(options)).toBe(false);
		} finally {
			await harness.destroy();
		}
	});

	it('resumes interrupted publication and still requests an index rebuild after publication', async () => {
		const { backend, options, files } = await fixture();
		backend.failMovePathIncludesOnce = 'projects/alpha/project.json';
		await expect(upgradeAlphaProjects(options)).rejects.toThrow('simulated move failure');
		expect(await readTextFile('projects/alpha/project.json', options)).toBe(files[0].content);
		expect(await upgradeAlphaProjects(options)).toBe(true);
		expect(await upgradeAlphaProjects(options)).toBe(true);
		await markAlphaUpgradesIndexed(options);
		expect(await upgradeAlphaProjects(options)).toBe(false);
	});

	it('leaves all project files untouched when a source hash is corrupt', async () => {
		const { backend, options } = await fixture();
		const path = `projects/alpha/collations/${alpha.id}.json`;
		await writeTextFileAtomic(
			path,
			(await readTextFile(path, options)).replace('Editorial notes', 'Tampered notes'),
			options
		);
		const before = new Map(backend.files);
		await expect(upgradeAlphaProjects(options)).rejects.toThrow('hash mismatch');
		expect(backend.files).toEqual(before);
	});

	it.each(['primary', 'checkpoint'])(
		'rejects a corrupt inner %s hash even with a valid envelope',
		async kind => {
			const { backend, options } = await fixture();
			const path =
				kind === 'primary'
					? `projects/alpha/collations/${alpha.id}.json`
					: `projects/alpha/history/collations/${alpha.id}/cp-alpha.json`;
			const { header, payload } = openEnvelope(await readTextFile(path, options));
			if (kind === 'primary')
				(payload.current_revision as JsonObject).content_hash = 'sha256:wrong';
			else payload.payload_content_hash = 'sha256:wrong';
			await backend.writeTextFile(
				joinStorePath(APP_STORE_ROOT, path),
				serializeSealedDocument(
					await sealDocument(header.format, header.schema_version, payload)
				)
			);
			const before = new Map(backend.files);
			await expect(upgradeAlphaProjects(options)).rejects.toThrow('hash mismatch');
			expect(backend.files).toEqual(before);
		}
	);

	it('refuses undirected alpha edges before publishing or retaining any files', async () => {
		const source = structuredClone(alpha);
		source.document.stemma.units[0].edges[0].directed = false;
		const { backend, options } = await fixture(source);
		const before = new Map(backend.files);
		await expect(upgradeAlphaProjects(options)).rejects.toThrow('undirected alpha stemma edge');
		expect(backend.files).toEqual(before);
	});

	it('converts omission decisions and automatic nonsense proposals without inventing a type decision', async () => {
		const source = structuredClone(alpha);
		source.document.apparatus.units[0].readings[1].classification = 'omit';
		const sourceReadings = source.document.apparatus.units[0].readings as Array<{
			readingType: string | null;
		}>;
		sourceReadings[0].readingType = 'ns';
		const { options } = await fixture(source);
		await upgradeAlphaProjects(options);
		const primary = await readCanonicalDocument<CollationPayload>(
			COLLATION_FORMAT,
			await readTextFile(`projects/alpha/collations/${alpha.id}.json`, options)
		);
		if (!primary.ok) throw new Error('Upgraded primary unreadable');
		const unit = primary.payload.document.apparatus!.units[0];
		expect(unit.decisions.readingType).toEqual({
			'r-b': 'omission',
			'split-c': 'orthographic',
		});
		expect(unit.readings.find(reading => reading.id === 'r-a')?.readingType).toBe('nonsense');
		expect(
			applyDecisions(unit.readings, unit.decisions).readings.find(
				reading => reading.id === 'r-b'
			)?.readingType
		).toBe('omission');
	});

	it('does not publish any converted files if retaining the originals fails', async () => {
		const { backend, options, files } = await fixture();
		backend.failWritePathIncludesOnce = 'original/history/';
		await expect(upgradeAlphaProjects(options)).rejects.toThrow('simulated write failure');
		for (const file of files)
			expect(await readTextFile(`projects/alpha/${file.path}`, options)).toBe(file.content);
		expect(await upgradeAlphaProjects(options)).toBe(true);
	});

	it.each(['revision', 'hash'])(
		'retains a draft with a stale %s through upgrade, backup restore and copy',
		async mismatch => {
			const { options } = await fixture();
			const path = `projects/alpha/collations/${alpha.id}.working.json`;
			const original = JSON.parse(await readTextFile(path, options));
			const { format, schema_version, content_hash: _, ...payload } = original;
			if (mismatch === 'revision') payload.draft.base_revision_id = 'superseded';
			payload.draft.base_content_hash = 'sha256:superseded';
			const stale = serializeSealedDocument(
				await sealDocument(format, schema_version, payload)
			);
			await writeTextFileAtomic(path, stale, options);
			await upgradeAlphaProjects(options);
			expect(await readTextFile(path, options)).toBe(stale);
			const harness = createLocalDbTestHarness();
			try {
				const report = await rebuildIndexFromStore(harness.db, options);
				expect(report.orphanedFiles).toEqual(
					expect.arrayContaining([expect.objectContaining({ code: 'stale_working' })])
				);
				expect(
					await harness.db.selectFrom('collations').select('notes').executeTakeFirst()
				).toMatchObject({ notes: 'Editorial notes' });
				const archive = await exportProjectZip(harness.db, alpha.project_id, {
					includeDrafts: true,
					storeOptions: options,
				});
				for (const collisionMode of [undefined, 'copy'] as const) {
					const restored = createLocalDbTestHarness();
					const storeOptions = { backend: new MemoryStoreBackend() };
					try {
						if (collisionMode)
							await createProject(
								restored.db,
								{ id: alpha.project_id, storageSlug: 'existing', name: 'Existing' },
								storeOptions
							);
						const result = await importProjectZip(restored.db, archive.bytes, {
							storeOptions,
							collisionMode,
						});
						expect(result).toMatchObject({ ok: true, quarantinedFiles: [] });
						expect(result.orphanedFiles).toEqual(
							expect.arrayContaining([
								expect.objectContaining({ code: 'stale_working' }),
							])
						);
						const raw = await readTextFile(
							`projects/${result.storageSlug}/collations/${alpha.id}.working.json`,
							storeOptions
						);
						const working = await readCanonicalDocument<WorkingCollationPayload>(
							WORKING_COLLATION_FORMAT,
							raw
						);
						if (!working.ok) throw new Error('Restored draft unreadable');
						expect(working.payload.draft).toEqual(payload.draft);
						expect(working.payload.notes).toBe('Unsaved editorial work');
						expect(
							await restored.db
								.selectFrom('collations')
								.select('notes')
								.where('project_id', '=', result.projectId!)
								.executeTakeFirst()
						).toMatchObject({ notes: 'Editorial notes' });
					} finally {
						await restored.destroy();
					}
				}
			} finally {
				await harness.destroy();
			}
		}
	);

	it('restores an alpha project backup with usable drafts and current revision hashes', async () => {
		const { files } = await fixture();
		const backend = new MemoryStoreBackend();
		const harness = createLocalDbTestHarness();
		try {
			const result = await importProjectFileTree(
				harness.db,
				files.map(file => ({ path: file.path, read: async () => file.content })),
				{ storeOptions: { backend } }
			);
			expect(result).toMatchObject({
				ok: true,
				transcriptionsRestored: 1,
				collationsRestored: 1,
				collationCheckpointsRestored: 1,
				quarantinedFiles: [],
			});
			expect(result.draftFilesRestored).toHaveLength(2);
			const archive = await exportProjectZip(harness.db, alpha.project_id, {
				includeDrafts: true,
				storeOptions: { backend },
			});
			const restored = createLocalDbTestHarness();
			try {
				const second = await importProjectZip(restored.db, archive.bytes, {
					storeOptions: { backend: new MemoryStoreBackend() },
				});
				expect(second).toMatchObject({
					ok: true,
					transcriptionsRestored: 1,
					collationsRestored: 1,
					collationCheckpointsRestored: 1,
					quarantinedFiles: [],
				});
			} finally {
				await restored.destroy();
			}
		} finally {
			await harness.destroy();
		}
	});
});

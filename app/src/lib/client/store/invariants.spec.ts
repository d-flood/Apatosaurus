import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	requestPersistentStorageForMeaningfulWrite,
	resetPersistenceRequestSessionForTests,
	shouldShowDurabilityWarning,
} from '$lib/client/capabilities';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/client/db/test-harness';
import { createCollation, loadCollation } from '$lib/client/db/repositories/collations';
import {
	createCollationWithFiles,
	createCommittedCollationCheckpointWithFiles,
	loadCollationWithWorkingFile,
	saveWorkingCollationArtifact,
} from '$lib/client/db/repositories/collation-files';
import { rebuildIndexFromStore } from '$lib/client/db/repositories/index-rebuild';
import { createProject } from '$lib/client/db/repositories/projects';
import { createTranscription, getTranscription } from '$lib/client/db/repositories/transcriptions';
import {
	createCommittedTranscriptionCheckpointWithFiles,
	createTranscriptionWithFiles,
	loadTranscriptionWithWorkingFile,
	saveWorkingTranscriptionContent,
} from '$lib/client/db/repositories/transcription-files';
import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { exportProjectZip } from '$lib/client/sync/project-zip-export';
import { importProjectZip } from '$lib/client/sync/project-zip-import';
import { MemoryStoreBackend } from './memory-store-backend.spec-support';
import {
	APP_STORE_ROOT,
	COLLATION_CHECKPOINT_CURRENT_VERSION,
	COLLATION_CHECKPOINT_FIXTURE,
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_CURRENT_VERSION,
	COLLATION_FIXTURE,
	COLLATION_FORMAT,
	PROJECT_MANIFEST_CURRENT_VERSION,
	PROJECT_MANIFEST_FIXTURE,
	PROJECT_MANIFEST_FORMAT,
	PROJECT_TRANSCRIPTION_CURRENT_VERSION,
	PROJECT_TRANSCRIPTION_FIXTURE,
	PROJECT_TRANSCRIPTION_FORMAT,
	TOMBSTONE_CURRENT_VERSION,
	TOMBSTONE_FIXTURE,
	TOMBSTONE_FORMAT,
	TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
	TRANSCRIPTION_CHECKPOINT_FIXTURE,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	WORKING_COLLATION_CURRENT_VERSION,
	WORKING_COLLATION_FIXTURE,
	WORKING_COLLATION_FORMAT,
	WORKING_TRANSCRIPTION_CURRENT_VERSION,
	WORKING_TRANSCRIPTION_FIXTURE,
	WORKING_TRANSCRIPTION_FORMAT,
	joinStorePath,
	moveFile,
	projectFolder,
	projectManifestFile,
	readCanonicalDocument,
	readTextFile,
	sealDocument,
	transcriptionPrimaryFile,
	transcriptionWorkingFile,
	writeTextFileAtomic,
	type JsonObject,
} from '.';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
});

afterEach(async () => {
	resetPersistenceRequestSessionForTests();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await harness.destroy();
});

describe('data-safety invariants', () => {
	it('Invariant 2: canonical replacements publish complete newer revisions atomically', async () => {
		await seedCompleteProject();
		const path = transcriptionPrimaryFile('project-slug', 'pt-1');
		const before = await readCanonicalDocument(
			PROJECT_TRANSCRIPTION_FORMAT,
			await readTextFile(path, { backend })
		);
		backend.writeOperations.length = 0;
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
			{ backend }
		);
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'revision-2' },
			{ backend }
		);
		const rawAfter = await readTextFile(path, { backend });
		const after = await readCanonicalDocument(PROJECT_TRANSCRIPTION_FORMAT, rawAfter);

		const targetPath = joinStorePath(APP_STORE_ROOT, path);
		const targetOperations = backend.writeOperations.filter(
			operation => operation.path === targetPath
		);
		expect(before).toMatchObject({ ok: true });
		expect(after).toMatchObject({
			ok: true,
			payload: { current_revision: { id: 'revision-2' } },
		});
		if (before.ok && after.ok) {
			expect(after.payload.current_revision).not.toEqual(before.payload.current_revision);
		}
		expect(targetOperations).toEqual([
			expect.objectContaining({ type: 'move', content: rawAfter }),
		]);
		expect(
			backend.writeOperations.some(
				operation => operation.type !== 'move' && operation.path === targetPath
			)
		).toBe(false);
		expect(await readTextFile(path, { backend })).toBe(rawAfter);
	});

	it('Invariant 3: history is append-only through write and move paths', async () => {
		const path = 'projects/invariants/history/transcriptions/entity/checkpoint.json';
		await writeTextFileAtomic(path, 'original checkpoint', { backend, nonce: () => 'first' });

		await expect(
			writeTextFileAtomic(path, 'rewritten checkpoint', { backend, nonce: () => 'rewrite' })
		).rejects.toThrow('append-only');
		await writeTextFileAtomic(path, 'original checkpoint', {
			backend,
			nonce: () => 'idempotent',
		});
		await writeTextFileAtomic('staging/rewrite.json', 'rewritten checkpoint', { backend });
		await expect(moveFile('staging/rewrite.json', path, { backend })).rejects.toThrow(
			'append-only'
		);

		expect(await readTextFile(path, { backend })).toBe('original checkpoint');
		expect(
			backend.writeOperations.filter(
				operation => operation.path === joinStorePath(APP_STORE_ROOT, path)
			)
		).toHaveLength(1);
	});

	it('Invariant 3 source guard: production writes cannot bypass the atomic store seam', () => {
		const sources = import.meta.glob(
			[
				'/src/lib/client/**/*.ts',
				'!/src/lib/client/**/*.spec.ts',
				'!/src/lib/client/**/*.svelte.spec.ts',
				'!/src/lib/client/**/*spec-support.ts',
			],
			{ eager: true, query: '?raw', import: 'default' }
		) as Record<string, string>;
		const bypasses = Object.entries(sources)
			.filter(
				([path, source]) =>
					path !== '/src/lib/client/store/opfs-store.ts' &&
					/\.writeTextFile\(/.test(source)
			)
			.map(([path]) => path);

		expect(bypasses).toEqual([]);
	});

	it('Invariant 4: a full canonical read pass does not mutate files', async () => {
		await seedCompleteProject();
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
			{ backend }
		);
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(collationDocument('alignment')),
			},
			{ backend }
		);
		const before = new Map(backend.files);

		await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', { backend });
		await loadCollationWithWorkingFile(harness.db, 'col-1', { backend });
		await rebuildIndexFromStore(harness.db, { backend });

		expect(new Map(backend.files)).toEqual(before);
	});

	it('Invariant 5: quarantine preserves corrupt bytes for every canonical format', async () => {
		const fixtures: Array<[string, number, JsonObject]> = [
			[PROJECT_MANIFEST_FORMAT, PROJECT_MANIFEST_CURRENT_VERSION, PROJECT_MANIFEST_FIXTURE],
			[
				PROJECT_TRANSCRIPTION_FORMAT,
				PROJECT_TRANSCRIPTION_CURRENT_VERSION,
				PROJECT_TRANSCRIPTION_FIXTURE,
			],
			[COLLATION_FORMAT, COLLATION_CURRENT_VERSION, COLLATION_FIXTURE],
			[
				TRANSCRIPTION_CHECKPOINT_FORMAT,
				TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
				TRANSCRIPTION_CHECKPOINT_FIXTURE,
			],
			[
				COLLATION_CHECKPOINT_FORMAT,
				COLLATION_CHECKPOINT_CURRENT_VERSION,
				COLLATION_CHECKPOINT_FIXTURE,
			],
			[TOMBSTONE_FORMAT, TOMBSTONE_CURRENT_VERSION, TOMBSTONE_FIXTURE],
			[
				WORKING_TRANSCRIPTION_FORMAT,
				WORKING_TRANSCRIPTION_CURRENT_VERSION,
				WORKING_TRANSCRIPTION_FIXTURE,
			],
			[
				WORKING_COLLATION_FORMAT,
				WORKING_COLLATION_CURRENT_VERSION,
				WORKING_COLLATION_FIXTURE,
			],
		];

		for (const [format, version, fixture] of fixtures) {
			const valid = await sealDocument(format, version, structuredClone(fixture));
			const corrupt = JSON.stringify({ ...valid, content_hash: 'sha256:corrupt' });
			const path = `quarantine/${format}.json`;
			await writeTextFileAtomic(path, corrupt, { backend });

			const result = await readCanonicalDocument(
				format,
				await readTextFile(path, { backend })
			);

			expect(result).toMatchObject({ ok: false, quarantine: { code: 'hash_mismatch' } });
			expect(await readTextFile(path, { backend })).toBe(corrupt);
		}
	});

	it.each([
		['transcription', 'history'],
		['transcription', 'primary'],
		['transcription', 'manifest'],
		['collation', 'history'],
		['collation', 'primary'],
		['collation', 'manifest'],
	] as const)(
		'Invariant 6: %s commit interruption at %s leaves a readable project',
		async (entityType, failureStep) => {
			await seedCrashFixture(entityType);
			const manifestBefore = await readTextFile(projectManifestFile('project-slug'), {
				backend,
			});
			const checkpointId = `${entityType}-${failureStep}-checkpoint`;
			backend.failWritePathIncludesOnce = crashFailurePath(
				entityType,
				failureStep,
				checkpointId
			);

			const commit =
				entityType === 'transcription'
					? createCommittedTranscriptionCheckpointWithFiles(
							harness.db,
							{ projectTranscriptionId: 'pt-1', checkpointId },
							{ backend, nonce: () => 'interrupted' }
						)
					: createCommittedCollationCheckpointWithFiles(
							harness.db,
							{ collationId: 'col-1', checkpointId },
							{ backend, nonce: () => 'interrupted' }
						);
			await expect(commit).rejects.toThrow('simulated write failure');

			expect(await readTextFile(projectManifestFile('project-slug'), { backend })).toBe(
				manifestBefore
			);
			expect(
				await readCanonicalDocument(PROJECT_MANIFEST_FORMAT, manifestBefore)
			).toMatchObject({ ok: true });
			const report = await rebuildIndexFromStore(harness.db, { backend });
			expect(report.projectsRestored).toBe(1);
			expect(report.quarantinedFiles).toEqual([]);
		}
	);

	it('Invariant 7: an interrupted working-file replacement recovers the previous draft', async () => {
		await seedCompleteProject();
		const path = transcriptionWorkingFile('project-slug', 'pt-1');
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
			{ backend }
		);
		const previousDraft = await readTextFile(path, { backend });
		backend.failMovePathIncludesOnce = path;

		await expect(
			saveWorkingTranscriptionContent(
				harness.db,
				{ id: 'tx-1', document: documentWithVerses(['Romans 1:3']) },
				{ backend, nonce: () => 'interrupted' }
			)
		).rejects.toThrow('simulated move failure');

		expect(await readTextFile(path, { backend })).toBe(previousDraft);
		expect(
			await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', { backend })
		).toMatchObject({
			content_json: expect.stringContaining('"verse":"2"'),
		});
	});

	it('Invariant 8: meaningful writes request persistence once and denied storage is surfaced', async () => {
		const persisted = vi.fn().mockResolvedValue(false);
		const persist = vi.fn().mockResolvedValue(false);
		vi.stubGlobal('navigator', { storage: { persisted, persist } });

		await requestPersistentStorageForMeaningfulWrite();
		await requestPersistentStorageForMeaningfulWrite();

		expect(persist).toHaveBeenCalledTimes(1);
		expect(persisted).toHaveBeenCalledTimes(2);
		expect(
			shouldShowDurabilityWarning({
				hasUserData: true,
				persistenceStatus: 'denied',
				dismissedMilestone: null,
				currentMilestone: 'projects:1',
			})
		).toBe(true);
	});

	it('Invariant 9: zip export and import restore a folder-equivalent project', async () => {
		await seedCompleteProject();
		const expected = projectFiles('project-slug');
		const exported = await exportProjectZip(harness.db, 'project-1', {
			storeOptions: { backend },
		});

		await harness.destroy();
		harness = createLocalDbTestHarness();
		backend = new MemoryStoreBackend();
		const imported = await importProjectZip(harness.db, exported.bytes, {
			storeOptions: { backend },
			nonce: () => 'invariant-round-trip',
		});

		expect(imported).toMatchObject({ ok: true, projectId: 'project-1', projectsRestored: 1 });
		expect(projectFiles(imported.storageSlug)).toEqual(expected);
		expect(await getTranscription(harness.db, 'tx-1')).toMatchObject({ title: 'Witness 1' });
		expect(await loadCollation(harness.db, 'col-1')).toMatchObject({
			row: { title: 'Romans 1:1' },
		});
	});
});

async function seedCompleteProject(): Promise<void> {
	await createProject(
		harness.db,
		{ id: 'project-1', storageSlug: 'project-slug', name: 'Romans' },
		{ backend }
	);
	await createTranscriptionWithFiles(
		harness.db,
		{
			id: 'tx-1',
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
			title: 'Witness 1',
			siglum: 'A',
			document: documentWithVerses(['Romans 1:1']),
			transcriber: 'Editor',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
		},
		{ backend }
	);
	await createCollationWithFiles(
		harness.db,
		{
			id: 'col-1',
			projectId: 'project-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Romans 1:1',
		},
		{ backend }
	);
}

async function seedCrashFixture(entityType: 'transcription' | 'collation'): Promise<void> {
	await createProject(
		harness.db,
		{ id: 'project-1', storageSlug: 'project-slug', name: 'Romans' },
		{ backend }
	);
	if (entityType === 'transcription') {
		await createTranscription(harness.db, {
			id: 'tx-1',
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
			title: 'Witness 1',
			siglum: 'A',
			document: documentWithVerses(['Romans 1:1']),
			transcriber: '',
			repository: '',
			settlement: '',
			language: 'grc',
		});
		return;
	}
	await createCollation(harness.db, {
		id: 'col-1',
		projectId: 'project-1',
		title: 'Romans 1:1',
		verseIdentifier: 'Romans 1:1',
	});
	await saveWorkingCollationArtifact(
		harness.db,
		{
			collationId: 'col-1',
			artifactType: 'collation_document_v1',
			payload: JSON.stringify(collationDocument('setup')),
		},
		{ backend }
	);
}

function crashFailurePath(
	entityType: 'transcription' | 'collation',
	failureStep: 'history' | 'primary' | 'manifest',
	checkpointId: string
): string {
	if (failureStep === 'manifest') return 'project.json.tmp-';
	if (entityType === 'transcription') {
		return failureStep === 'history'
			? `history/transcriptions/pt-1/${checkpointId}.json.tmp-`
			: 'transcriptions/pt-1.json.tmp-';
	}
	return failureStep === 'history'
		? `history/collations/col-1/${checkpointId}.json.tmp-`
		: 'collations/col-1.json.tmp-';
}

function projectFiles(storageSlug: string): Record<string, string> {
	const prefix = `${joinStorePath(APP_STORE_ROOT, projectFolder(storageSlug))}/`;
	return Object.fromEntries(
		[...backend.files.entries()]
			.filter(([path]) => path.startsWith(prefix))
			.map(([path, content]) => [path.slice(prefix.length), content])
			.sort(([left], [right]) => left.localeCompare(right))
	);
}

function documentWithVerses(verses: string[]): StoredTranscriptionDocument {
	return {
		type: 'transcriptionDocument',
		pages: [
			{
				type: 'page',
				id: 'page-1',
				columns: [
					{
						type: 'column',
						number: 1,
						lines: [
							{
								type: 'line',
								number: 1,
								items: verses.map(identifier => {
									const [book, chapterVerse] = identifier.split(' ');
									const [chapter, verse] = chapterVerse.split(':');
									return {
										type: 'milestone' as const,
										kind: 'verse' as const,
										attrs: { book, chapter, verse },
									};
								}),
							},
						],
					},
				],
			},
		],
	};
}

function collationDocument(phase: string) {
	return {
		type: 'collationDocument',
		version: 1,
		meta: { collationId: 'col-1', projectId: 'project-1', projectName: 'Romans' },
		flow: {
			phase,
			furthestPhase: phase,
			alignmentDisplayMode: 'regularized',
			alignmentLayout: 'grid',
		},
		setup: {
			selectedVerse: null,
			selectedBook: 'Romans',
			selectedChapter: '1',
			selectedVerseNum: '1',
			witnesses: [],
		},
		settings: {
			regularizationRules: [],
			ignoreWordBreaks: false,
			lowercase: false,
			ignoreTokenWhitespace: true,
			ignorePunctuation: false,
			suppliedTextMode: 'clear',
			segmentation: true,
		},
		alignment: null,
		apparatus: null,
		stemma: null,
	};
}

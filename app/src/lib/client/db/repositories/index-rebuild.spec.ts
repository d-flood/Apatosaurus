import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import {
	StoreMoveUnavailableError,
	APP_STORE_ROOT,
	COLLATION_FIXTURE,
	joinStorePath,
	normalizeStorePath,
	projectFolder,
	projectManifestFile,
	readCanonicalDocument,
	hashCanonicalPayload,
	PROJECT_MANIFEST_FORMAT,
	serializeCanonicalDocument,
	storePathBasename,
	storePathDirname,
	transcriptionWorkingFile,
	WORKING_TRANSCRIPTION_FORMAT,
	type ProjectManifestPayload,
	type WorkingTranscriptionPayload,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
} from '$lib/client/store';

import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import {
	createCollationWithFiles,
	loadCollationWithWorkingFile,
	saveWorkingCollationArtifact,
	saveWorkingCollationMetadata,
} from './collation-files';
import { ensureManifestSourceWithFiles } from './iiif-files';
import { listManifestSources } from './iiif';
import { rebuildIndexFromStore, restoreOrphanPrimaryToProject } from './index-rebuild';
import {
	createProject,
	ensureDefaultProject,
	getProject,
	listProjects,
	updateProjectMetadata,
} from './projects';
import { listCommittedTranscriptionCheckpoints } from './revisions';
import {
	createCommittedTranscriptionCheckpointWithFiles,
	loadTranscriptionWithWorkingFile,
	saveWorkingTranscriptionMetadata,
} from './transcription-files';
import { createTranscription, listVerseIndexRows } from './transcriptions';

let harness: LocalDbTestHarness;

beforeEach(() => {
	harness = createLocalDbTestHarness();
});

afterEach(async () => {
	await harness.destroy();
});

describe('rebuildIndexFromStore', () => {
	it('does not publish IIIF index changes when the canonical working write fails', async () => {
		const backend = new MemoryStoreBackend();
		const storeOptions = { backend };
		await createProject(
			harness.db,
			{ id: 'project-1', storageSlug: 'project-slug', name: 'Project' },
			storeOptions
		);
		await createTranscription(harness.db, {
			id: 'tx-1',
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
			title: 'Witness',
			siglum: '01',
			document: documentWithVerses(['Romans 1:1']),
			transcriber: '',
			repository: '',
			settlement: '',
			language: 'grc',
		});
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1' },
			storeOptions
		);
		backend.failWrites = true;

		await expect(
			ensureManifestSourceWithFiles(
				harness.db,
				{ transcriptionId: 'tx-1', manifestUrl: 'https://example.test/failed' },
				storeOptions
			)
		).rejects.toThrow('simulated write failure');
		await expect(listManifestSources(harness.db, 'tx-1')).resolves.toEqual([]);
	});

	it('restores an empty bootstrapped Default project', async () => {
		const backend = new MemoryStoreBackend();
		const storeOptions = { backend, nonce: () => 'default-project' };
		const projectId = await ensureDefaultProject(harness.db, storeOptions);
		const before = await getProject(harness.db, projectId);

		await rebuildIndexFromStore(harness.db, storeOptions);

		expect(await getProject(harness.db, projectId)).toEqual(before);
	});

	it('restores an empty project with exact metadata and immutable storage slug', async () => {
		const backend = new MemoryStoreBackend();
		const storeOptions = { backend, nonce: () => 'empty-project' };
		await createProject(
			harness.db,
			{
				id: 'empty-project',
				storageSlug: 'immutable-folder',
				name: 'Initial',
				createdAt: '2026-07-13T10:00:00.000Z',
				updatedAt: '2026-07-13T10:00:00.000Z',
			},
			storeOptions
		);
		await updateProjectMetadata(
			harness.db,
			{
				projectId: 'empty-project',
				name: 'Renamed',
				description: 'Description',
				charter: 'Charter',
				collationSettings: { segmentation: false },
				updatedAt: '2026-07-13T11:00:00.000Z',
			},
			storeOptions
		);

		await rebuildIndexFromStore(harness.db, storeOptions);

		expect(await getProject(harness.db, 'empty-project')).toEqual({
			id: 'empty-project',
			storageSlug: 'immutable-folder',
			name: 'Renamed',
			description: 'Description',
			charter: 'Charter',
			collationSettings: { segmentation: false },
			createdAt: '2026-07-13T10:00:00.000Z',
			updatedAt: '2026-07-13T11:00:00.000Z',
		});
	});

	it('does not publish project create or metadata changes when the manifest write fails', async () => {
		const backend = new ManifestWriteFailureBackend();
		backend.failWrites = true;
		await expect(
			createProject(
				harness.db,
				{ id: 'failed-project', name: 'Failed' },
				{ backend }
			)
		).rejects.toThrow('manifest write failed');
		expect(await getProject(harness.db, 'failed-project')).toBeNull();

		backend.failWrites = false;
		await createProject(
			harness.db,
			{ id: 'project-1', storageSlug: 'project-1', name: 'Original' },
			{ backend }
		);
		backend.failWrites = true;
		await expect(
			updateProjectMetadata(
				harness.db,
				{ projectId: 'project-1', name: 'Unpublished' },
				{ backend }
			)
		).rejects.toThrow('manifest write failed');
		expect(await getProject(harness.db, 'project-1')).toMatchObject({ name: 'Original' });
	});

	it('restores index rows from canonical project files', async () => {
		const backend = new MemoryStoreBackend();
		let nonce = 0;
		const storeOptions = { backend, nonce: () => `rebuild-${++nonce}` };

		await createProject(
			harness.db,
			{
				id: 'project-1',
				storageSlug: 'project-slug',
				name: 'Project',
				createdAt: '2026-07-06T00:00:00.000Z',
				updatedAt: '2026-07-06T00:00:00.000Z',
			},
			storeOptions
		);
		await createTranscription(harness.db, {
			id: 'tx-1',
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
			title: 'Witness 1',
			siglum: '01',
			document: documentWithVerses(['Romans 1:1']),
			createdAt: '2026-07-06T00:01:00.000Z',
			updatedAt: '2026-07-06T00:01:00.000Z',
			transcriber: 'Editor',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
		});
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: 'pt-1',
				checkpointId: 'z-parent',
				createdAt: '2026-07-06T00:01:30.000Z',
			},
			storeOptions
		);
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: 'pt-1',
				checkpointId: 'a-child',
				createdAt: '2026-07-06T00:01:45.000Z',
			},
			storeOptions
		);
		await createCollationWithFiles(
			harness.db,
			{
				id: 'col-1',
				projectId: 'project-1',
				title: 'Romans 1:1',
				verseIdentifier: 'Romans 1:1',
				now: '2026-07-06T00:02:00.000Z',
			},
			storeOptions
		);
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify({
					...COLLATION_FIXTURE.document,
					meta: { collationId: 'col-1', projectId: 'project-1', projectName: 'Project' },
					setup: {
						...COLLATION_FIXTURE.document.setup,
						witnesses: [
							{
								type: 'witness',
								id: '01',
								siglum: '01',
								transcriptionId: 'tx-1',
								sourceVersion: 'a-child',
								sourceContentHash: 'sha256:tx-1',
								content: 'in principio',
								treatment: 'full',
								isBaseText: true,
								isExcluded: false,
								overridesDefault: false,
								sourceTokens: [],
							},
						],
					},
				}),
				now: '2026-07-06T00:02:30.000Z',
			},
			storeOptions
		);
		await updateProjectMetadata(
			harness.db,
			{ projectId: 'project-1', name: 'Updated Project' },
			storeOptions
		);
		await saveWorkingTranscriptionMetadata(
			harness.db,
			{
				id: 'tx-1',
				title: 'Updated Witness',
				siglum: '01',
				description: 'Durable metadata',
				tags: ['durable'],
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
			storeOptions
		);
		await saveWorkingCollationMetadata(
			harness.db,
			{ id: 'col-1', title: 'Updated Collation', notes: 'Durable notes' },
			storeOptions
		);
		await ensureManifestSourceWithFiles(
			harness.db,
			{ transcriptionId: 'tx-1', manifestUrl: 'https://example.test/manifest', label: 'MS' },
			storeOptions
		);

		await harness.db
			.updateTable('transcriptions')
			.set({
				title: 'Stale cache title',
				content_json: JSON.stringify(documentWithVerses(['Romans 9:9'])),
			})
			.where('id', '=', 'tx-1')
			.execute();
		await harness.db
			.deleteFrom('collation_artifacts')
			.where('collation_id', '=', 'col-1')
			.execute();

		const report = await rebuildIndexFromStore(harness.db, { backend });

		expect(report).toMatchObject({
			projectsRestored: 1,
			transcriptionsRestored: 1,
			collationsRestored: 1,
			transcriptionCheckpointsRestored: 2,
			collationCheckpointsRestored: 1,
			tombstonesRestored: 0,
			quarantinedFiles: [],
			orphanedFiles: [],
		});
		expect(await listProjects(harness.db)).toEqual([
			expect.objectContaining({
				id: 'project-1',
				storageSlug: 'project-slug',
				name: 'Updated Project',
			}),
		]);
		expect(
			await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', { backend })
		).toMatchObject({
			id: 'tx-1',
			project_id: 'project-1',
			title: 'Updated Witness',
			siglum: '01',
			description: 'Durable metadata',
		});
		expect(await listVerseIndexRows(harness.db)).toEqual([
			expect.objectContaining({ transcription_id: 'tx-1', verse_identifier: 'Romans 1:1' }),
		]);
		expect(await listCommittedTranscriptionCheckpoints(harness.db, 'tx-1')).toEqual([
			expect.objectContaining({
				id: 'a-child',
				parentCheckpointId: 'z-parent',
				isCommitted: true,
			}),
			expect.objectContaining({
				id: 'z-parent',
				parentCheckpointId: null,
				isCommitted: true,
			}),
		]);
		expect(await loadCollationWithWorkingFile(harness.db, 'col-1', { backend })).toMatchObject({
			row: expect.objectContaining({
				id: 'col-1',
				projectId: 'project-1',
				title: 'Updated Collation',
				notes: 'Durable notes',
			}),
		});
		expect(await listManifestSources(harness.db, 'tx-1')).toEqual([
			expect.objectContaining({ manifestUrl: 'https://example.test/manifest', label: 'MS' }),
		]);
		await expect(
			harness.db
				.selectFrom('collation_witnesses')
				.select(['transcription_id', 'project_transcription_id'])
				.where('collation_id', '=', 'col-1')
				.executeTakeFirstOrThrow()
		).resolves.toEqual({ transcription_id: 'tx-1', project_transcription_id: 'pt-1' });
	});

	it('ignores a stale working transcription when rebuilding the live index', async () => {
		const backend = new MemoryStoreBackend();
		const storeOptions = { backend, nonce: () => 'stale-working' };
		await createProject(
			harness.db,
			{ id: 'project-1', storageSlug: 'project-slug', name: 'Project' },
			storeOptions
		);
		await createTranscription(harness.db, {
			id: 'tx-1',
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
			title: 'Committed title',
			siglum: '01',
			document: documentWithVerses(['Romans 1:1']),
			transcriber: '',
			repository: '',
			settlement: '',
			language: 'grc',
		});
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1' },
			storeOptions
		);
		await saveWorkingTranscriptionMetadata(
			harness.db,
			{
				id: 'tx-1',
				title: 'Stale draft title',
				siglum: '01',
				description: '',
				tags: [],
				transcriber: '',
				repository: '',
				settlement: '',
				language: 'grc',
			},
			storeOptions
		);
		const workingPath = transcriptionWorkingFile('project-slug', 'pt-1');
		const workingRead = await readCanonicalDocument<WorkingTranscriptionPayload>(
			WORKING_TRANSCRIPTION_FORMAT,
			await backend.readTextFile(joinStorePath(APP_STORE_ROOT, workingPath))
		);
		if (!workingRead.ok) throw new Error(workingRead.quarantine.message);
		const staleWorking = {
			...workingRead.payload,
			draft: {
				...workingRead.payload.draft,
				base_revision_id: 'superseded',
				base_content_hash: 'sha256:superseded',
			},
		};
		await backend.writeTextFile(
			joinStorePath(APP_STORE_ROOT, workingPath),
			await serializeCanonicalDocument(
				WORKING_TRANSCRIPTION_FORMAT,
				staleWorking as never
			)
		);

		const report = await rebuildIndexFromStore(harness.db, storeOptions);

		expect(await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', storeOptions)).toMatchObject({
			title: 'Committed title',
		});
		expect(report.orphanedFiles).toContainEqual(
			expect.objectContaining({ path: workingPath, code: 'stale_working', recoverable: false })
		);
	});

	it('reports every unsupported project file individually without mutating files', async () => {
		const backend = new MemoryStoreBackend();
		const storeOptions = { backend, nonce: () => 'orphans' };
		await createProject(
			harness.db,
			{ id: 'project-1', storageSlug: 'project-slug', name: 'Project' },
			storeOptions
		);
		await backend.writeTextFile(
			joinStorePath(APP_STORE_ROOT, 'projects/project-slug/transcriptions/orphan.json'),
			'{}'
		);
		await backend.writeTextFile(
			joinStorePath(APP_STORE_ROOT, 'projects/project-slug/transcriptions/orphan.working.json'),
			'{}'
		);
		await backend.writeTextFile(
			joinStorePath(APP_STORE_ROOT, 'projects/project-slug/transcriptions/orphan.tei.xml'),
			'<TEI/>'
		);
		await backend.writeTextFile(
			joinStorePath(APP_STORE_ROOT, 'projects/project-slug/history/transcriptions/orphan/cp.json'),
			'{}'
		);
		await backend.writeTextFile(
			joinStorePath(APP_STORE_ROOT, 'projects/project-slug/tombstones/transcription--orphan.json'),
			'{}'
		);
		await backend.writeTextFile(
			joinStorePath(APP_STORE_ROOT, 'projects/no-manifest/transcriptions/lost.json'),
			'{}'
		);
		const filesBefore = new Map(backend.files);

		const report = await rebuildIndexFromStore(harness.db, storeOptions);

		expect(report.orphanedFiles).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: 'projects/project-slug/transcriptions/orphan.json',
					code: 'unreferenced_primary',
					recoverable: false,
				}),
				expect.objectContaining({
					path: 'projects/project-slug/transcriptions/orphan.working.json',
					code: 'unreferenced_working',
				}),
				expect.objectContaining({
					path: 'projects/project-slug/history/transcriptions/orphan/cp.json',
					code: 'unreferenced_history',
				}),
				expect.objectContaining({
					path: 'projects/project-slug/tombstones/transcription--orphan.json',
					code: 'unreferenced_tombstone',
				}),
				expect.objectContaining({
					path: 'projects/project-slug/transcriptions/orphan.tei.xml',
					code: 'unreferenced_tei',
				}),
				expect.objectContaining({
					path: projectFolder('no-manifest'),
					code: 'missing_project_manifest',
				}),
				expect.objectContaining({
					path: 'projects/no-manifest/transcriptions/lost.json',
					code: 'unreferenced_primary',
				}),
			])
		);
		expect(report.orphanedFiles).toHaveLength(7);
		expect(backend.files).toEqual(filesBefore);
		expect(
			backend.files.has(joinStorePath(APP_STORE_ROOT, projectManifestFile('project-slug')))
		).toBe(true);
	});

	it('restores a validated orphan primary through the manifest before rebuilding', async () => {
		const backend = new MemoryStoreBackend();
		const storeOptions = { backend, nonce: () => 'restore-orphan' };
		await createProject(
			harness.db,
			{ id: 'project-1', storageSlug: 'project-slug', name: 'Project' },
			storeOptions
		);
		await createTranscription(harness.db, {
			id: 'tx-1',
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
			title: 'Recovered witness',
			siglum: 'R',
			document: documentWithVerses(['Romans 1:1']),
			transcriber: '',
			repository: '',
			settlement: '',
			language: 'grc',
		});
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1' },
			storeOptions
		);
		const manifestPath = projectManifestFile('project-slug');
		const manifestRead = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			await backend.readTextFile(joinStorePath(APP_STORE_ROOT, manifestPath))
		);
		if (!manifestRead.ok) throw new Error(manifestRead.quarantine.message);
		const orphanedManifest = {
			...manifestRead.payload,
			transcriptions: [],
			manifest_content_hash: await hashCanonicalPayload({
				project_id: 'project-1',
				transcriptions: [],
				collations: manifestRead.payload.collations,
				tombstones: manifestRead.payload.tombstones,
			}),
		};
		await backend.writeTextFile(
			joinStorePath(APP_STORE_ROOT, manifestPath),
			await serializeCanonicalDocument(PROJECT_MANIFEST_FORMAT, orphanedManifest as never)
		);

		const orphanReport = await rebuildIndexFromStore(harness.db, storeOptions);
		const orphan = orphanReport.orphanedFiles.find(file => file.path.endsWith('/pt-1.json'));
		expect(orphan).toMatchObject({ recoverable: true, entityType: 'transcription' });
		expect(await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', storeOptions)).toBeNull();

		const restored = await restoreOrphanPrimaryToProject(
			harness.db,
			orphan?.path ?? '',
			storeOptions
		);
		expect(restored.orphanedFiles).not.toContainEqual(
			expect.objectContaining({ path: orphan?.path })
		);
		expect(await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', storeOptions)).toMatchObject({
			title: 'Recovered witness',
		});

		await rebuildIndexFromStore(harness.db, storeOptions);
		expect(await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', storeOptions)).toMatchObject({
			title: 'Recovered witness',
		});
	});
});

function documentWithVerses(verses: string[]): StoredTranscriptionDocument {
	return {
		type: 'transcriptionDocument' as const,
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

class MemoryStoreBackend implements StoreBackend {
	readonly files = new Map<string, string>();
	readonly directories = new Set<string>(['']);
	failWrites = false;

	async readTextFile(path: string): Promise<string> {
		const normalized = normalizeStorePath(path);
		const content = this.files.get(normalized);
		if (content === undefined) throw new Error(`File ${path} was not found.`);
		return content;
	}

	async writeTextFile(path: string, content: string): Promise<void> {
		if (this.failWrites) throw new Error('simulated write failure');
		const normalized = normalizeStorePath(path);
		this.addDirectory(storePathDirname(normalized));
		this.files.set(normalized, content);
	}

	async deleteFile(path: string): Promise<void> {
		const normalized = normalizeStorePath(path);
		if (!this.files.delete(normalized)) throw new Error(`File ${path} was not found.`);
	}

	async listDirectory(path: string): Promise<StoreBackendDirectoryEntry[]> {
		const normalized = normalizeStorePath(path);
		if (!this.directories.has(normalized)) throw new Error(`Directory ${path} was not found.`);
		const entries = new Map<string, StoreBackendDirectoryEntry>();
		for (const directory of this.directories) {
			if (!directory || directory === normalized) continue;
			if (storePathDirname(directory) === normalized) {
				entries.set(storePathBasename(directory), {
					name: storePathBasename(directory),
					kind: 'directory',
				});
			}
		}
		for (const file of this.files.keys()) {
			if (storePathDirname(file) === normalized) {
				entries.set(storePathBasename(file), {
					name: storePathBasename(file),
					kind: 'file',
				});
			}
		}
		return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
	}

	async ensureDirectory(path: string): Promise<void> {
		this.addDirectory(path);
	}

	async moveFile(fromPath: string, toPath: string): Promise<void> {
		const normalizedFrom = normalizeStorePath(fromPath);
		const normalizedTo = normalizeStorePath(toPath);
		const content = this.files.get(normalizedFrom);
		if (content === undefined) throw new StoreMoveUnavailableError();
		this.addDirectory(storePathDirname(normalizedTo));
		this.files.delete(normalizedFrom);
		this.files.set(normalizedTo, content);
	}

	private addDirectory(path: string): void {
		const normalized = normalizeStorePath(path);
		let current = '';
		this.directories.add(current);
		for (const segment of normalized ? normalized.split('/') : []) {
			current = joinStorePath(current, segment);
			this.directories.add(current);
		}
	}
}

class ManifestWriteFailureBackend extends MemoryStoreBackend {
	failWrites = false;

	override async writeTextFile(path: string, content: string): Promise<void> {
		if (this.failWrites && path.includes('project.json')) throw new Error('manifest write failed');
		await super.writeTextFile(path, content);
	}
}

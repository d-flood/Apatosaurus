import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	COLLATION_FORMAT,
	COLLATION_CHECKPOINT_FORMAT,
	PROJECT_MANIFEST_FORMAT,
	PROJECT_TRANSCRIPTION_FORMAT,
	TOMBSTONE_FORMAT,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	collationCheckpointFile,
	collationPrimaryFile,
	joinStorePath,
	normalizeStorePath,
	projectManifestFile,
	readCanonicalDocument,
	readTextFile,
	StoreMoveUnavailableError,
	storePathBasename,
	storePathDirname,
	tombstoneFile,
	transcriptionCheckpointFile,
	transcriptionPrimaryFile,
	type ProjectManifestPayload,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
	type TombstonePayload,
} from '$lib/client/store';
import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import { createCollation } from './collations';
import {
	createCommittedCollationCheckpointWithFiles,
	saveWorkingCollationArtifact,
} from './collation-files';
import { deleteCollationWithFiles, deleteTranscriptionWithFiles } from './entity-deletion';
import { createProject } from './projects';
import { createTranscription } from './transcriptions';
import { createCommittedTranscriptionCheckpointWithFiles } from './transcription-files';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
});

afterEach(async () => {
	await harness.destroy();
});

describe('entity deletion file persistence', () => {
	it('writes a transcription tombstone, updates the manifest, removes the primary, and preserves history', async () => {
		await createCommittedFixtureTranscription();

		await deleteTranscriptionWithFiles(
			harness.db,
			'tx-1',
			{
				tombstoneId: 'tombstone-pt-1',
				deletedBy: 'Editor',
				deletedAt: '2026-07-04T14:00:00.000Z',
			},
			{ backend, nonce: () => 'delete-write' }
		);

		const tombstoneRaw = await readTextFile(
			tombstoneFile('project-slug', 'project-transcription', 'pt-1'),
			{ backend }
		);
		const tombstone = await readCanonicalDocument<TombstonePayload>(
			TOMBSTONE_FORMAT,
			tombstoneRaw
		);
		const manifest = await readProjectManifest();

		expect(tombstone).toMatchObject({
			ok: true,
			payload: {
				id: 'tombstone-pt-1',
				project_id: 'project-1',
				entity_type: 'project-transcription',
				entity_id: 'pt-1',
				cloud_path: 'transcriptions/pt-1.json',
				deletion_revision_id: 'tx-cp-1',
				deleted_by: 'Editor',
				deleted_at: '2026-07-04T14:00:00.000Z',
			},
		});
		expect(manifest.payload.transcriptions).toEqual([]);
		expect(manifest.payload.tombstones).toMatchObject([
			{
				tombstone_id: 'tombstone-pt-1',
				entity_type: 'project-transcription',
				entity_id: 'pt-1',
				primary_path: 'tombstones/project-transcription--pt-1.json',
			},
		]);
		await expect(
			readTextFile(transcriptionPrimaryFile('project-slug', 'pt-1'), { backend })
		).rejects.toThrow('not found');
		await expect(
			readTextFile(transcriptionCheckpointFile('project-slug', 'pt-1', 'tx-cp-1'), {
				backend,
			})
		).resolves.toContain('tx-cp-1');
		await expect(
			harness.db.selectFrom('transcriptions').selectAll().where('id', '=', 'tx-1').execute()
		).resolves.toEqual([]);
		await expect(
			harness.db
				.selectFrom('sync_tombstones')
				.selectAll()
				.where('id', '=', 'tombstone-pt-1')
				.execute()
		).resolves.toMatchObject([
			{
				entity_type: 'project-transcription',
				entity_id: 'pt-1',
				cloud_path: 'transcriptions/pt-1.json',
			},
		]);
	});

	it('writes a collation tombstone, updates the manifest, removes the primary, and preserves history', async () => {
		await createCommittedFixtureCollation();

		await deleteCollationWithFiles(
			harness.db,
			'col-1',
			{
				tombstoneId: 'tombstone-col-1',
				deletedAt: '2026-07-04T14:30:00.000Z',
			},
			{ backend, nonce: () => 'delete-write' }
		);

		const tombstoneRaw = await readTextFile(
			tombstoneFile('project-slug', 'collation', 'col-1'),
			{
				backend,
			}
		);
		const tombstone = await readCanonicalDocument<TombstonePayload>(
			TOMBSTONE_FORMAT,
			tombstoneRaw
		);
		const manifest = await readProjectManifest();

		expect(tombstone).toMatchObject({
			ok: true,
			payload: {
				id: 'tombstone-col-1',
				entity_type: 'collation',
				entity_id: 'col-1',
				cloud_path: 'collations/col-1.json',
				deletion_revision_id: 'col-cp-1',
				deleted_at: '2026-07-04T14:30:00.000Z',
			},
		});
		expect(manifest.payload.collations).toEqual([]);
		expect(manifest.payload.tombstones).toMatchObject([
			{
				tombstone_id: 'tombstone-col-1',
				entity_type: 'collation',
				entity_id: 'col-1',
				primary_path: 'tombstones/collation--col-1.json',
			},
		]);
		await expect(
			readTextFile(collationPrimaryFile('project-slug', 'col-1'), { backend })
		).rejects.toThrow('not found');
		await expect(
			readTextFile(collationCheckpointFile('project-slug', 'col-1', 'col-cp-1'), { backend })
		).resolves.toContain('col-cp-1');
		await expect(
			harness.db.selectFrom('collations').selectAll().where('id', '=', 'col-1').execute()
		).resolves.toEqual([]);
	});

	it('leaves the index and primary untouched when manifest writing fails after tombstone creation', async () => {
		await createCommittedFixtureTranscription();
		backend.failWritePathIncludes = 'project.json.tmp-';

		await expect(
			deleteTranscriptionWithFiles(
				harness.db,
				'tx-1',
				{
					tombstoneId: 'tombstone-pt-1',
					deletedAt: '2026-07-04T14:00:00.000Z',
				},
				{ backend, nonce: () => 'manifest-fail' }
			)
		).rejects.toThrow('simulated write failure');

		await expect(
			readTextFile(tombstoneFile('project-slug', 'project-transcription', 'pt-1'), {
				backend,
			})
		).resolves.toContain('tombstone-pt-1');
		await expect(
			readTextFile(transcriptionPrimaryFile('project-slug', 'pt-1'), { backend })
		).resolves.toContain('tx-cp-1');
		await expect(
			harness.db.selectFrom('transcriptions').selectAll().where('id', '=', 'tx-1').execute()
		).resolves.toHaveLength(1);
		await expect(
			harness.db
				.selectFrom('sync_tombstones')
				.selectAll()
				.where('id', '=', 'tombstone-pt-1')
				.execute()
		).resolves.toEqual([]);
		const manifest = await readProjectManifest();
		expect(manifest.payload.transcriptions).toHaveLength(1);
		expect(manifest.payload.tombstones).toEqual([]);
	});

	it('does not fail deletion when the primary file cannot be removed', async () => {
		await createCommittedFixtureCollation();
		backend.failDeletePathIncludes = 'collations/col-1.json';
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		try {
			await deleteCollationWithFiles(
				harness.db,
				'col-1',
				{
					tombstoneId: 'tombstone-col-1',
					deletedAt: '2026-07-04T14:30:00.000Z',
				},
				{ backend, nonce: () => 'delete-write' }
			);

			await expect(
				readTextFile(collationPrimaryFile('project-slug', 'col-1'), { backend })
			).resolves.toContain('col-cp-1');
			await expect(
				harness.db.selectFrom('collations').selectAll().where('id', '=', 'col-1').execute()
			).resolves.toEqual([]);
			expect(warn).toHaveBeenCalledWith(
				'[document-store] Could not remove deleted entity primary file.',
				expect.objectContaining({ entityType: 'collation', entityId: 'col-1' })
			);
		} finally {
			warn.mockRestore();
		}
	});
});

async function createCommittedFixtureTranscription(): Promise<void> {
	await createProject(harness.db, {
		id: 'project-1',
		storageSlug: 'project-slug',
		name: 'Project',
		createdAt: '2026-07-04T00:00:00.000Z',
		updatedAt: '2026-07-04T00:00:00.000Z',
	});
	await createTranscription(harness.db, {
		id: 'tx-1',
		projectId: 'project-1',
		projectTranscriptionId: 'pt-1',
		title: 'Witness 1',
		siglum: '01',
		document: documentWithVerses(['Romans 1:1']),
		createdAt: '2026-07-04T00:00:00.000Z',
		updatedAt: '2026-07-04T00:00:00.000Z',
		transcriber: 'Editor',
		repository: 'Library',
		settlement: 'City',
		language: 'grc',
	});
	await createCommittedTranscriptionCheckpointWithFiles(
		harness.db,
		{
			projectTranscriptionId: 'pt-1',
			checkpointId: 'tx-cp-1',
			createdAt: '2026-07-04T13:00:00.000Z',
		},
		{ backend, nonce: () => 'commit-write' }
	);
	await expectCanonicalFile(
		transcriptionPrimaryFile('project-slug', 'pt-1'),
		PROJECT_TRANSCRIPTION_FORMAT
	);
	await expectCanonicalFile(
		transcriptionCheckpointFile('project-slug', 'pt-1', 'tx-cp-1'),
		TRANSCRIPTION_CHECKPOINT_FORMAT
	);
}

async function createCommittedFixtureCollation(): Promise<void> {
	await createProject(harness.db, {
		id: 'project-1',
		storageSlug: 'project-slug',
		name: 'Project',
		createdAt: '2026-07-04T00:00:00.000Z',
		updatedAt: '2026-07-04T00:00:00.000Z',
	});
	await createCollation(harness.db, {
		id: 'col-1',
		projectId: 'project-1',
		title: 'Romans 1:1',
		verseIdentifier: 'Rom 1:1',
		now: '2026-07-04T00:00:00.000Z',
	});
	await saveWorkingCollationArtifact(
		harness.db,
		{
			collationId: 'col-1',
			artifactId: 'artifact-1',
			artifactType: 'collation_document_v1',
			payload: JSON.stringify(collationDocument()),
			now: '2026-07-04T12:00:00.000Z',
		},
		{ backend, nonce: () => 'working-write' }
	);
	await createCommittedCollationCheckpointWithFiles(
		harness.db,
		{
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
			createdAt: '2026-07-04T13:00:00.000Z',
		},
		{ backend, nonce: () => 'commit-write' }
	);
	await expectCanonicalFile(collationPrimaryFile('project-slug', 'col-1'), COLLATION_FORMAT);
	await expectCanonicalFile(
		collationCheckpointFile('project-slug', 'col-1', 'col-cp-1'),
		COLLATION_CHECKPOINT_FORMAT
	);
}

async function readProjectManifest(): Promise<{ payload: ProjectManifestPayload }> {
	const raw = await readTextFile(projectManifestFile('project-slug'), { backend });
	const parsed = await readCanonicalDocument<ProjectManifestPayload>(
		PROJECT_MANIFEST_FORMAT,
		raw
	);
	if (!parsed.ok) throw new Error('project manifest did not parse');
	return parsed;
}

async function expectCanonicalFile(path: string, format: string): Promise<void> {
	const raw = await readTextFile(path, { backend });
	const parsed = await readCanonicalDocument(format, raw);
	expect(parsed).toMatchObject({ ok: true });
}

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

function collationDocument() {
	return {
		type: 'collationDocument',
		version: 1,
		meta: { collationId: 'col-1', projectId: 'project-1', projectName: 'Project' },
		flow: {
			phase: 'readings',
			furthestPhase: 'readings',
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

class MemoryStoreBackend implements StoreBackend {
	readonly files = new Map<string, string>();
	readonly directories = new Set<string>(['']);
	failWrites = false;
	failWritePathIncludes: string | null = null;
	failDeletePathIncludes: string | null = null;

	async readTextFile(path: string): Promise<string> {
		const normalized = normalizeStorePath(path);
		const content = this.files.get(normalized);
		if (content === undefined) throw new Error(`File ${path} was not found.`);
		return content;
	}

	async writeTextFile(path: string, content: string): Promise<void> {
		const normalized = normalizeStorePath(path);
		if (
			this.failWrites ||
			(this.failWritePathIncludes && normalized.includes(this.failWritePathIncludes))
		) {
			throw new Error(`simulated write failure for ${path}`);
		}
		this.addDirectory(storePathDirname(normalized));
		this.files.set(normalized, content);
	}

	async deleteFile(path: string): Promise<void> {
		const normalized = normalizeStorePath(path);
		if (this.failDeletePathIncludes && normalized.includes(this.failDeletePathIncludes)) {
			throw new Error(`simulated delete failure for ${path}`);
		}
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

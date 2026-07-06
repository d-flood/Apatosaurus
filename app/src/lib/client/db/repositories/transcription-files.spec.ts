import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import { projectWriteLockName } from './project-locks';
import { createProject } from './projects';
import { createTranscription, getTranscription } from './transcriptions';
import {
	createTranscriptionWithFiles,
	createCommittedTranscriptionCheckpointWithFiles,
	loadTranscriptionWithWorkingFile,
	saveWorkingTranscriptionContent,
} from './transcription-files';
import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import {
	PROJECT_MANIFEST_FORMAT,
	PROJECT_TRANSCRIPTION_FORMAT,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	joinStorePath,
	normalizeStorePath,
	projectManifestFile,
	readCanonicalDocument,
	readTextFile,
	StoreMoveUnavailableError,
	storePathBasename,
	storePathDirname,
	transcriptionCheckpointFile,
	transcriptionPrimaryFile,
	transcriptionTeiFile,
	transcriptionWorkingFile,
	WORKING_TRANSCRIPTION_FORMAT,
	type ProjectManifestPayload,
	type ProjectTranscriptionPayload,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
	type TranscriptionCheckpointPayload,
	type WorkingTranscriptionPayload,
} from '$lib/client/store';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await harness.destroy();
});

describe('transcription file persistence', () => {
	it('writes the working transcription file before updating the index cache', async () => {
		await createFixtureTranscription();
		backend.failWrites = true;

		await expect(
			saveWorkingTranscriptionContent(
				harness.db,
				{
					id: 'tx-1',
					document: documentWithVerses(['Romans 1:2']),
					updatedAt: '2026-07-04T12:00:00.000Z',
				},
				{ backend, nonce: () => 'failed-write' }
			)
		).rejects.toThrow('simulated write failure');

		const row = await getTranscription(harness.db, 'tx-1');
		expect(row?.content_json).toContain('"verse":"1"');
		expect(row?.updated_at).toBe('2026-07-04T00:00:00.000Z');
	});

	it('stores a canonical working file and then updates the index cache', async () => {
		await createFixtureTranscription();

		await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: 'tx-1',
				document: documentWithVerses(['Romans 1:2']),
				updatedAt: '2026-07-04T12:00:00.000Z',
			},
			{ backend, nonce: () => 'working-write' }
		);

		const path = transcriptionWorkingFile('project-slug', 'pt-1');
		const raw = await readTextFile(path, { backend });
		const parsed = await readCanonicalDocument<WorkingTranscriptionPayload>(
			WORKING_TRANSCRIPTION_FORMAT,
			raw
		);
		const row = await getTranscription(harness.db, 'tx-1');

		expect(parsed).toMatchObject({
			ok: true,
			payload: {
				project_transcription_id: 'pt-1',
				id: 'tx-1',
				content_format: 'normalized_ast_v3',
				updated_at: '2026-07-04T12:00:00.000Z',
				draft: {
					base_revision_id: null,
					base_content_hash: null,
					saved_at: '2026-07-04T12:00:00.000Z',
				},
			},
		});
		if (!parsed.ok) throw new Error('working file did not parse');
		expect(JSON.stringify(parsed.payload.content_json)).toContain('"verse":"2"');
		expect(row?.content_json).toContain('"verse":"2"');
		expect(row?.updated_at).toBe('2026-07-04T12:00:00.000Z');
	});

	it('loads a newer working file when the index cache is stale', async () => {
		await createFixtureTranscription();
		await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: 'tx-1',
				document: documentWithVerses(['Romans 1:2']),
				updatedAt: '2026-07-04T12:00:00.000Z',
			},
			{ backend, nonce: () => 'working-write' }
		);
		await harness.db
			.updateTable('transcriptions')
			.set({
				content_json: JSON.stringify(documentWithVerses(['Romans 1:1'])),
				updated_at: '2026-07-04T00:00:00.000Z',
			})
			.where('id', '=', 'tx-1')
			.execute();

		const loaded = await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', { backend });

		expect(loaded?.content_json).toContain('"verse":"2"');
		expect(loaded?.updated_at).toBe('2026-07-04T12:00:00.000Z');
	});

	it('loads the committed primary file when no working file exists and the index cache is stale', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Project',
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		});
		await createTranscriptionWithFiles(
			harness.db,
			{
				id: 'tx-1',
				projectId: 'project-1',
				projectTranscriptionId: 'pt-1',
				title: 'Witness 1',
				siglum: '01',
				document: documentWithVerses(['Romans 1:2']),
				createdAt: '2026-07-04T00:00:00.000Z',
				updatedAt: '2026-07-04T00:00:00.000Z',
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
			{ backend, nonce: () => 'create-write' }
		);
		await harness.db
			.updateTable('transcriptions')
			.set({
				title: 'Stale index title',
				content_json: JSON.stringify(documentWithVerses(['Romans 1:1'])),
				updated_at: '2026-07-04T12:00:00.000Z',
			})
			.where('id', '=', 'tx-1')
			.execute();

		const loaded = await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', { backend });

		expect(loaded?.title).toBe('Witness 1');
		expect(loaded?.content_json).toContain('"verse":"2"');
		expect(loaded?.updated_at).toBe('2026-07-04T00:00:00.000Z');
	});

	it('creates a transcription through the initial committed file path', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Project',
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		});

		const id = await createTranscriptionWithFiles(
			harness.db,
			{
				id: 'tx-created',
				projectId: 'project-1',
				projectTranscriptionId: 'pt-created',
				title: 'Created Witness',
				siglum: 'C',
				document: documentWithVerses(['Romans 1:3']),
				createdAt: '2026-07-04T00:00:00.000Z',
				updatedAt: '2026-07-04T00:00:00.000Z',
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
			{ backend, nonce: () => 'create-write' }
		);
		const head = await harness.db
			.selectFrom('transcriptions')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', 'tx-created')
			.executeTakeFirstOrThrow();

		const historyRaw = await readTextFile(
			transcriptionCheckpointFile('project-slug', 'pt-created', head.current_revision_id),
			{ backend }
		);
		const primaryRaw = await readTextFile(
			transcriptionPrimaryFile('project-slug', 'pt-created'),
			{
				backend,
			}
		);
		const manifestRaw = await readTextFile(projectManifestFile('project-slug'), { backend });
		const tei = await readTextFile(transcriptionTeiFile('project-slug', 'pt-created'), {
			backend,
		});
		const history = await readCanonicalDocument<TranscriptionCheckpointPayload>(
			TRANSCRIPTION_CHECKPOINT_FORMAT,
			historyRaw
		);
		const primary = await readCanonicalDocument<ProjectTranscriptionPayload>(
			PROJECT_TRANSCRIPTION_FORMAT,
			primaryRaw
		);
		const manifest = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			manifestRaw
		);

		expect(id).toBe('tx-created');
		expect(head.current_revision_id).toBeTruthy();
		expect(history).toMatchObject({
			ok: true,
			payload: {
				checkpoint_id: head.current_revision_id,
				entity_id: 'pt-created',
				payload_content_hash: head.current_content_hash,
			},
		});
		expect(primary).toMatchObject({
			ok: true,
			payload: {
				project_transcription_id: 'pt-created',
				id: 'tx-created',
				current_revision: {
					id: head.current_revision_id,
					content_hash: head.current_content_hash,
				},
			},
		});
		expect(manifest).toMatchObject({
			ok: true,
			payload: {
				transcriptions: [
					{
						project_transcription_id: 'pt-created',
						current_revision: {
							id: head.current_revision_id,
							content_hash: head.current_content_hash,
						},
					},
				],
			},
		});
		expect(tei).toContain('<TEI');
	});

	it('writes committed transcription files before updating the index', async () => {
		await createFixtureTranscription();

		const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: 'pt-1',
				checkpointId: 'tx-cp-1',
				commitMessage: 'Initial commit',
				authorName: 'Editor',
				createdAt: '2026-07-04T13:00:00.000Z',
			},
			{ backend, nonce: () => 'commit-write' }
		);

		const historyRaw = await readTextFile(
			transcriptionCheckpointFile('project-slug', 'pt-1', 'tx-cp-1'),
			{ backend }
		);
		const history = await readCanonicalDocument<TranscriptionCheckpointPayload>(
			TRANSCRIPTION_CHECKPOINT_FORMAT,
			historyRaw
		);
		const primaryRaw = await readTextFile(transcriptionPrimaryFile('project-slug', 'pt-1'), {
			backend,
		});
		const primary = await readCanonicalDocument<ProjectTranscriptionPayload>(
			PROJECT_TRANSCRIPTION_FORMAT,
			primaryRaw
		);
		const manifestRaw = await readTextFile(projectManifestFile('project-slug'), { backend });
		const manifest = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			manifestRaw
		);
		const tei = await readTextFile(transcriptionTeiFile('project-slug', 'pt-1'), { backend });
		const head = await harness.db
			.selectFrom('transcriptions')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', 'tx-1')
			.executeTakeFirstOrThrow();

		expect(history).toMatchObject({
			ok: true,
			payload: {
				checkpoint_id: 'tx-cp-1',
				entity_id: 'pt-1',
				payload_transcription_id: 'tx-1',
				payload_content_hash: checkpoint.contentHash,
				commit_message: 'Initial commit',
			},
		});
		expect(primary).toMatchObject({
			ok: true,
			payload: {
				project_transcription_id: 'pt-1',
				id: 'tx-1',
				current_revision: {
					id: 'tx-cp-1',
					content_hash: checkpoint.contentHash,
					created_at: '2026-07-04T13:00:00.000Z',
					author_name: 'Editor',
				},
			},
		});
		expect(manifest).toMatchObject({
			ok: true,
			payload: {
				id: 'project-1',
				transcriptions: [
					{
						project_transcription_id: 'pt-1',
						current_revision: { id: 'tx-cp-1', content_hash: checkpoint.contentHash },
						primary_path: 'transcriptions/pt-1.json',
					},
				],
			},
		});
		expect(tei).toContain('<TEI');
		expect(head).toEqual({
			current_revision_id: 'tx-cp-1',
			current_content_hash: checkpoint.contentHash,
		});
	});

	it('does not update the index when manifest writing fails after entity files', async () => {
		await createFixtureTranscription();
		backend.failWritePathIncludes = 'project.json.tmp-';

		await expect(
			createCommittedTranscriptionCheckpointWithFiles(
				harness.db,
				{
					projectTranscriptionId: 'pt-1',
					checkpointId: 'tx-cp-manifest-fail',
					createdAt: '2026-07-04T13:00:00.000Z',
				},
				{ backend, nonce: () => 'manifest-fail' }
			)
		).rejects.toThrow('simulated write failure');

		await expect(
			readTextFile(
				transcriptionCheckpointFile('project-slug', 'pt-1', 'tx-cp-manifest-fail'),
				{ backend }
			)
		).resolves.toContain('tx-cp-manifest-fail');
		await expect(
			readTextFile(transcriptionPrimaryFile('project-slug', 'pt-1'), { backend })
		).resolves.toContain('tx-cp-manifest-fail');
		await expect(
			readTextFile(projectManifestFile('project-slug'), { backend })
		).rejects.toThrow('not found');
		await expect(
			harness.db
				.selectFrom('transcription_checkpoints')
				.selectAll()
				.where('id', '=', 'tx-cp-manifest-fail')
				.execute()
		).resolves.toEqual([]);
		await expect(
			harness.db
				.selectFrom('transcriptions')
				.select(['current_revision_id', 'current_content_hash'])
				.where('id', '=', 'tx-1')
				.executeTakeFirstOrThrow()
		).resolves.toEqual({ current_revision_id: '', current_content_hash: '' });
	});

	it('does not fail the commit when derived TEI writing fails', async () => {
		await createFixtureTranscription();
		backend.failWritePathIncludes = '.tei.xml.tmp-';
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		try {
			const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
				harness.db,
				{
					projectTranscriptionId: 'pt-1',
					checkpointId: 'tx-cp-tei-fail',
					createdAt: '2026-07-04T13:00:00.000Z',
				},
				{ backend, nonce: () => 'tei-fail' }
			);

			expect(checkpoint.id).toBe('tx-cp-tei-fail');
			await expect(
				readTextFile(transcriptionTeiFile('project-slug', 'pt-1'), { backend })
			).rejects.toThrow('not found');
			await expect(
				readTextFile(projectManifestFile('project-slug'), { backend })
			).resolves.toContain('tx-cp-tei-fail');
			await expect(
				harness.db
					.selectFrom('transcriptions')
					.select(['current_revision_id', 'current_content_hash'])
					.where('id', '=', 'tx-1')
					.executeTakeFirstOrThrow()
			).resolves.toEqual({
				current_revision_id: 'tx-cp-tei-fail',
				current_content_hash: checkpoint.contentHash,
			});
		} finally {
			warn.mockRestore();
		}
	});

	it('runs committed transcription file writes under the project write lock', async () => {
		await createFixtureTranscription();
		const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) =>
			callback()
		);
		vi.stubGlobal('navigator', { locks: { request } });

		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: 'pt-1',
				checkpointId: 'tx-cp-locked',
				createdAt: '2026-07-04T13:00:00.000Z',
			},
			{ backend, nonce: () => 'locked-write' }
		);

		expect(request).toHaveBeenCalledWith(
			projectWriteLockName('project-1'),
			expect.any(Function)
		);
	});
});

async function createFixtureTranscription(): Promise<void> {
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

class MemoryStoreBackend implements StoreBackend {
	readonly files = new Map<string, string>();
	readonly directories = new Set<string>(['']);
	failWrites = false;
	failWritePathIncludes: string | null = null;

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

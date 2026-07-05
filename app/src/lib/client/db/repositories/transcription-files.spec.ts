import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import { createProject } from './projects';
import { createTranscription, getTranscription } from './transcriptions';
import {
	loadTranscriptionWithWorkingFile,
	saveWorkingTranscriptionContent,
} from './transcription-files';
import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import {
	joinStorePath,
	normalizeStorePath,
	readCanonicalDocument,
	readTextFile,
	StoreMoveUnavailableError,
	storePathBasename,
	storePathDirname,
	transcriptionWorkingFile,
	WORKING_TRANSCRIPTION_FORMAT,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
	type WorkingTranscriptionPayload,
} from '$lib/client/store';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
});

afterEach(async () => {
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
				entries.set(storePathBasename(file), { name: storePathBasename(file), kind: 'file' });
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

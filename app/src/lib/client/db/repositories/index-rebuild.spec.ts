import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import {
	StoreMoveUnavailableError,
	joinStorePath,
	normalizeStorePath,
	storePathBasename,
	storePathDirname,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
} from '$lib/client/store';

import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import { createCollationWithFiles, loadCollationWithWorkingFile } from './collation-files';
import { rebuildIndexFromStore } from './index-rebuild';
import { createProject, listProjects } from './projects';
import { listCommittedTranscriptionCheckpoints } from './revisions';
import {
	createCommittedTranscriptionCheckpointWithFiles,
	loadTranscriptionWithWorkingFile,
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
	it('restores index rows from canonical project files', async () => {
		const backend = new MemoryStoreBackend();
		let nonce = 0;
		const storeOptions = { backend, nonce: () => `rebuild-${++nonce}` };

		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Project',
			createdAt: '2026-07-06T00:00:00.000Z',
			updatedAt: '2026-07-06T00:00:00.000Z',
		});
		await createTranscription(
			harness.db,
			{
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
			}
		);
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

		await harness.db
			.updateTable('transcriptions')
			.set({
				title: 'Stale cache title',
				content_json: JSON.stringify(documentWithVerses(['Romans 9:9'])),
			})
			.where('id', '=', 'tx-1')
			.execute();
		await harness.db.deleteFrom('collation_artifacts').where('collation_id', '=', 'col-1').execute();

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
			expect.objectContaining({ id: 'project-1', storageSlug: 'project-slug', name: 'Project' }),
		]);
		expect(await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', { backend })).toMatchObject({
			id: 'tx-1',
			project_id: 'project-1',
			title: 'Witness 1',
			siglum: '01',
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
			expect.objectContaining({ id: 'z-parent', parentCheckpointId: null, isCommitted: true }),
		]);
		expect(await loadCollationWithWorkingFile(harness.db, 'col-1', { backend })).toMatchObject({
			row: expect.objectContaining({ id: 'col-1', projectId: 'project-1' }),
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

	async readTextFile(path: string): Promise<string> {
		const normalized = normalizeStorePath(path);
		const content = this.files.get(normalized);
		if (content === undefined) throw new Error(`File ${path} was not found.`);
		return content;
	}

	async writeTextFile(path: string, content: string): Promise<void> {
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

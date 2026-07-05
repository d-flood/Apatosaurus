import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	collationWorkingFile,
	joinStorePath,
	normalizeStorePath,
	readCanonicalDocument,
	readTextFile,
	StoreMoveUnavailableError,
	storePathBasename,
	storePathDirname,
	WORKING_COLLATION_FORMAT,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
	type WorkingCollationPayload,
} from '$lib/client/store';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import { createProject } from './projects';
import { createCollation, loadCollation } from './collations';
import { createCommittedCollationCheckpoint } from './revisions';
import {
	getCollationVersionStatusWithWorkingFile,
	loadCollationWithWorkingFile,
	saveWorkingCollationArtifact,
} from './collation-files';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
});

afterEach(async () => {
	await harness.destroy();
});

describe('collation file persistence', () => {
	it('writes the working collation file before updating artifact storage', async () => {
		await createFixtureCollation();
		backend.failWrites = true;

		await expect(
			saveWorkingCollationArtifact(
				harness.db,
				{
					collationId: 'col-1',
					artifactType: 'collation_document_v1',
					payload: JSON.stringify(collationDocument('alignment')),
					now: '2026-07-04T12:00:00.000Z',
				},
				{ backend, nonce: () => 'failed-write' }
			)
		).rejects.toThrow('simulated write failure');

		await expect(
			harness.db.selectFrom('collation_artifacts').selectAll().execute()
		).resolves.toEqual([]);
		await expect(loadCollation(harness.db, 'col-1')).resolves.toMatchObject({
			artifact: null,
			row: { updatedAt: '2026-07-04T00:00:00.000Z' },
		});
	});

	it('stores a canonical working file and leaves collation_artifacts empty', async () => {
		await createFixtureCollation();

		const artifactId = await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(collationDocument('alignment')),
				now: '2026-07-04T12:00:00.000Z',
			},
			{ backend, nonce: () => 'working-write' }
		);

		const raw = await readTextFile(collationWorkingFile('project-slug', 'col-1'), { backend });
		const parsed = await readCanonicalDocument<WorkingCollationPayload>(
			WORKING_COLLATION_FORMAT,
			raw
		);

		expect(parsed).toMatchObject({
			ok: true,
			payload: {
				id: 'col-1',
				project_id: 'project-1',
				title: 'Romans 1:1',
				status: 'alignment',
				updated_at: '2026-07-04T12:00:00.000Z',
				draft: {
					base_revision_id: null,
					base_content_hash: null,
					saved_at: '2026-07-04T12:00:00.000Z',
				},
				artifacts: [
					{
						id: artifactId,
						artifact_type: 'collation_document_v1',
					},
				],
			},
		});
		if (!parsed.ok) throw new Error('working file did not parse');
		const payload = parsed.payload as unknown as {
			artifacts: Array<{ payload: unknown }>;
		};
		expect(payload.artifacts[0].payload).toMatchObject({
			flow: { phase: 'alignment' },
		});
		await expect(
			harness.db.selectFrom('collation_artifacts').selectAll().execute()
		).resolves.toEqual([]);
	});

	it('loads a working file when the index artifact cache is empty', async () => {
		await createFixtureCollation();
		const artifactId = await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(collationDocument('readings')),
				now: '2026-07-04T12:00:00.000Z',
			},
			{ backend, nonce: () => 'working-write' }
		);

		const loaded = await loadCollationWithWorkingFile(harness.db, 'col-1', { backend });

		expect(loaded?.artifact).toMatchObject({
			id: artifactId,
			artifactType: 'collation_document_v1',
		});
		expect(loaded?.artifact?.payload).toContain('"phase":"readings"');
		expect(loaded?.row.status).toBe('readings');
		expect(loaded?.row.updatedAt).toBe('2026-07-04T12:00:00.000Z');
	});

	it('uses the working file to compute dirty status', async () => {
		await createFixtureCollation();
		const checkpoint = await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
			createdAt: '2026-07-04T01:00:00.000Z',
		});
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(collationDocument('setup')),
				now: '2026-07-04T12:00:00.000Z',
			},
			{ backend, nonce: () => 'working-write' }
		);

		const status = await getCollationVersionStatusWithWorkingFile(
			harness.db,
			'col-1',
			{},
			{ backend }
		);

		expect(status.currentCheckpoint).toEqual({
			revisionId: 'col-cp-1',
			contentHash: checkpoint.contentHash,
		});
		expect(status.workingContentHash).not.toBe(checkpoint.contentHash);
		expect(status.dirtyToCheckpoint).toBe(true);
		expect(status.commitState).toBe('dirty');
	});
});

async function createFixtureCollation(): Promise<void> {
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
}

function collationDocument(phase: string) {
	return {
		type: 'collationDocument',
		version: 1,
		meta: { collationId: 'col-1', projectId: 'project-1', projectName: 'Project' },
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';

import { removeCurrentIndexFiles } from './index-files';
import type { DbRequest, DbRequestPayload, DbWorkerMessage } from './rpc';
import { purgeLocalDbStorage } from './storage-reset';

const PROJECT_ID = 'project-delete-index-invariant';
const PROJECT_SLUG = 'project-delete-index-invariant';
const TRANSCRIPTION_ID = 'tx-delete-index-invariant';
const PROJECT_TRANSCRIPTION_ID = 'pt-delete-index-invariant';
const COLLATION_ID = 'col-delete-index-invariant';

let client: WorkerClient | null = null;

beforeEach(async () => {
	await cleanupOpfs();
});

afterEach(async () => {
	client?.terminate();
	client = null;
	await cleanupOpfs();
});

describe('delete-the-index invariant', () => {
	it('rebuilds listings, loads, verse index, and collation projections after the index files are deleted', async () => {
		client = new WorkerClient();
		await client.request({ type: 'init' });
		await createProjectTranscriptionAndCollation(client);
		const beforeDeletion = await loadObservedState(client);

		await client.request({ type: 'checkpoint' });
		client.terminate();
		client = null;
		const removalReport = await removeCurrentIndexFiles();
		expect(removalReport.failedPaths).toEqual([]);
		expect(removalReport.removedPaths).toContain(
			'apatosaurus/v1/index/apatosaurus-index-v1.db'
		);

		client = new WorkerClient();
		await client.request({ type: 'init' });
		const afterRebuild = await loadObservedState(client);

		expect(afterRebuild).toEqual(beforeDeletion);
		expect(afterRebuild).toMatchObject({
			project: {
				id: PROJECT_ID,
				storageSlug: PROJECT_SLUG,
				name: 'Delete Index Invariant',
			},
			transcriptionSummaries: [
				{
					id: TRANSCRIPTION_ID,
					title: 'Witness A',
					siglum: 'A',
				},
			],
			transcriptionContent: expect.stringContaining('"verse":"2"'),
			verseIdentifiers: ['Romans 1:2'],
			collationListings: [
				{
					id: COLLATION_ID,
					projectId: PROJECT_ID,
					title: 'Romans 1:2 Collation',
					status: 'readings',
				},
			],
			collationRow: {
				id: COLLATION_ID,
				projectId: PROJECT_ID,
				status: 'readings',
			},
			collationProjection: {
				witnesses: [
					{
						witnessId: 'A',
						transcriptionId: TRANSCRIPTION_ID,
						content: 'εν αρχη',
						position: 0,
					},
				],
				tokens: [{ witnessId: 'A', tokenIndex: 0, tokenText: 'εν' }],
				variationUnits: [
					{
						startIndex: 0,
						endIndex: 1,
						unitType: 'variation',
						baseText: 'εν',
						readings: [
							{
								readingOrder: 0,
								readingText: 'εν',
								isOmission: false,
								isLacuna: false,
								witnessIds: ['A'],
							},
						],
					},
				],
			},
		});
		expect(afterRebuild.transcriptionCheckpoints).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'tx-initial-checkpoint', isCommitted: true }),
			])
		);
	}, 60_000);
});

async function createProjectTranscriptionAndCollation(db: WorkerClient): Promise<void> {
	await db.request({
		type: 'projects.create',
		input: {
			id: PROJECT_ID,
			storageSlug: PROJECT_SLUG,
			name: 'Delete Index Invariant',
			createdAt: '2026-07-06T10:00:00.000Z',
			updatedAt: '2026-07-06T10:00:00.000Z',
		},
	});
	await db.request({
		type: 'transcriptions.create',
		input: {
			id: TRANSCRIPTION_ID,
			projectId: PROJECT_ID,
			projectTranscriptionId: PROJECT_TRANSCRIPTION_ID,
			title: 'Witness A',
			siglum: 'A',
			document: documentWithVerse('Romans 1:1'),
			createdAt: '2026-07-06T10:01:00.000Z',
			updatedAt: '2026-07-06T10:01:00.000Z',
			transcriber: 'Editor',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
		},
	});
	await db.request({
		type: 'revisions.commitTranscription',
		input: {
			projectTranscriptionId: PROJECT_TRANSCRIPTION_ID,
			checkpointId: 'tx-initial-checkpoint',
			commitMessage: 'Initial witness',
			authorName: 'Editor',
			createdAt: '2026-07-06T10:02:00.000Z',
		},
	});
	await db.request({
		type: 'transcriptions.updateContent',
		input: {
			id: TRANSCRIPTION_ID,
			document: documentWithVerse('Romans 1:2'),
			updatedAt: '2026-07-06T10:03:00.000Z',
		},
	});
	await db.request({
		type: 'collations.create',
		input: {
			id: COLLATION_ID,
			projectId: PROJECT_ID,
			title: 'Romans 1:2 Collation',
			verseIdentifier: 'Romans 1:2',
			now: '2026-07-06T10:04:00.000Z',
		},
	});
	await db.request({
		type: 'collations.saveProjection',
		input: {
			collationId: COLLATION_ID,
			witnesses: [
				{
					witnessId: 'A',
					transcriptionId: TRANSCRIPTION_ID,
					sourceVersion: 'tx-initial-checkpoint',
					content: 'εν αρχη',
					position: 0,
				},
			],
			tokens: [{ witnessId: 'A', tokenIndex: 0, tokenText: 'εν' }],
			variationUnits: [
				{
					startIndex: 0,
					endIndex: 1,
					unitType: 'variation',
					baseText: 'εν',
					readings: [
						{
							readingOrder: 0,
							readingText: 'εν',
							isOmission: false,
							isLacuna: false,
							witnessIds: ['A'],
						},
					],
				},
			],
		},
	});
	await db.request({
		type: 'collations.saveArtifact',
		input: {
			collationId: COLLATION_ID,
			artifactId: 'col-working-artifact',
			artifactType: 'collation_document_v1',
			payload: JSON.stringify({
				type: 'collationDocument',
				version: 1,
				flow: { phase: 'readings', furthestPhase: 'readings' },
			}),
			now: '2026-07-06T10:05:00.000Z',
		},
	});
	await db.request({
		type: 'collations.updateMetadata',
		input: {
			id: COLLATION_ID,
			status: 'readings',
			updatedAt: '2026-07-06T10:05:00.000Z',
		},
	});
}

async function loadObservedState(db: WorkerClient) {
	const [
		projects,
		transcriptionSummaries,
		transcription,
		verseRows,
		checkpoints,
		collationListings,
		collation,
	] = await Promise.all([
		db.request<Array<Record<string, unknown>>>({ type: 'projects.list' }),
		db.request<Array<Record<string, unknown>>>({ type: 'transcriptions.listSummaries' }),
		db.request<Record<string, unknown> | null>({
			type: 'transcriptions.get',
			transcriptionId: TRANSCRIPTION_ID,
		}),
		db.request<Array<Record<string, unknown>>>({
			type: 'transcriptions.listVerseIndexRowsForTranscription',
			transcriptionId: TRANSCRIPTION_ID,
		}),
		db.request<Array<Record<string, unknown>>>({
			type: 'revisions.listCommittedTranscriptionCheckpoints',
			transcriptionId: TRANSCRIPTION_ID,
		}),
		db.request<Array<Record<string, unknown>>>({ type: 'collations.listWithProjectNames' }),
		db.request<Record<string, unknown> | null>({
			type: 'collations.load',
			collationId: COLLATION_ID,
		}),
	]);
	if (!transcription) throw new Error('Expected transcription to load.');
	if (!collation) throw new Error('Expected collation to load.');
	const collationRecord = collation as {
		row: Record<string, unknown>;
		projection: Record<string, unknown>;
	};

	return {
		project: projects.find(row => row.id === PROJECT_ID),
		transcriptionSummaries: transcriptionSummaries
			.filter(row => row.id === TRANSCRIPTION_ID)
			.map(row => pick(row, ['id', 'title', 'siglum', 'created_at', 'updated_at'])),
		transcriptionContent: transcription.content_json,
		verseIdentifiers: verseRows.map(row => row.verse_identifier).sort(),
		transcriptionCheckpoints: checkpoints.map(row =>
			pick(row, [
				'id',
				'parentCheckpointId',
				'isCommitted',
				'commitMessage',
				'authorName',
				'createdAt',
			])
		),
		collationListings: collationListings
			.filter(row => row.id === COLLATION_ID)
			.map(row =>
				pick(row, [
					'id',
					'projectId',
					'projectName',
					'title',
					'verseIdentifier',
					'status',
					'updatedAt',
				])
			),
		collationRow: pick(collationRecord.row, [
			'id',
			'projectId',
			'title',
			'verseIdentifier',
			'status',
			'createdAt',
			'updatedAt',
		]),
		collationProjection: collationRecord.projection,
	};
}

function documentWithVerse(identifier: string): StoredTranscriptionDocument {
	const [book, chapterVerse] = identifier.split(' ');
	const [chapter, verse] = chapterVerse.split(':');
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
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book, chapter, verse },
									},
								],
							},
						],
					},
				],
			},
		],
	};
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
	return Object.fromEntries(keys.map(key => [key, source[key]]));
}

async function cleanupOpfs(): Promise<void> {
	client?.terminate();
	client = null;
	await purgeLocalDbStorage();
	if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function')
		return;
	const root = await navigator.storage.getDirectory();
	await root.removeEntry('apatosaurus', { recursive: true }).catch(error => {
		if (!isNotFoundError(error)) throw error;
	});
}

function isNotFoundError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error as { name?: unknown }).name === 'NotFoundError'
	);
}

class WorkerClient {
	private readonly worker = new Worker(new URL('./db.worker.ts', import.meta.url), {
		type: 'module',
	});
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timeoutId: ReturnType<typeof setTimeout>;
		}
	>();

	constructor() {
		this.worker.addEventListener('message', (event: MessageEvent<DbWorkerMessage>) => {
			const message = event.data;
			if (!('id' in message)) return;
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timeoutId);
			if (message.ok) pending.resolve('result' in message ? message.result : undefined);
			else pending.reject(new Error(message.error));
		});
	}

	request<T = unknown>(payload: DbRequestPayload): Promise<T> {
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out waiting for ${payload.type}.`));
			}, 60_000);
			this.pending.set(id, {
				resolve: value => resolve(value as T),
				reject,
				timeoutId,
			});
			this.worker.postMessage({ id, ...payload } as DbRequest);
		});
	}

	terminate(): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timeoutId);
			pending.reject(new Error(`Worker terminated with request ${id} pending.`));
		}
		this.pending.clear();
		this.worker.terminate();
	}
}

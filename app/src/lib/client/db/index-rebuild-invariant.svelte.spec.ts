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
const EMPTY_PROJECT_ID = 'empty-delete-index-invariant';
const COPY_PROJECT_ID = 'copy-delete-index-invariant';
const DELETED_TRANSCRIPTION_ID = 'tx-deleted-index-invariant';

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
		const removalReport = await removeIndexFilesAfterWorkerRelease();
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
			emptyProject: {
				id: EMPTY_PROJECT_ID,
				name: 'Renamed Empty Project',
				description: 'Durable empty project',
				charter: 'Keep every witness',
				collationSettings: { segmentation: false },
			},
			transcriptionSummaries: [
				{
					id: TRANSCRIPTION_ID,
					title: 'Witness A Updated',
					siglum: 'A',
				},
			],
			iiifSources: [
				expect.objectContaining({
					manifestUrl: 'https://example.test/manifest',
					label: 'Durable manuscript',
				}),
			],
			iiifLinks: [
				expect.objectContaining({
					pageId: 'page-1',
					canvasId: 'https://example.test/canvas/1',
				}),
			],
			deletedTombstones: [
				expect.objectContaining({ entity_id: 'pt-deleted-index-invariant' }),
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
						endIndex: 0,
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

async function removeIndexFilesAfterWorkerRelease() {
	const removedPaths = new Set<string>();
	let lastReport = await removeCurrentIndexFiles();
	for (const path of lastReport.removedPaths) removedPaths.add(path);
	for (let attempt = 0; attempt < 10 && hasHandleReleaseFailure(lastReport); attempt += 1) {
		await new Promise(resolve => setTimeout(resolve, 50));
		lastReport = await removeCurrentIndexFiles();
		for (const path of lastReport.removedPaths) removedPaths.add(path);
	}
	return { ...lastReport, removedPaths: [...removedPaths] };
}

function hasHandleReleaseFailure(report: Awaited<ReturnType<typeof removeCurrentIndexFiles>>): boolean {
	return (
		report.failedPaths.length > 0 &&
		report.failedPaths.every(failure => /modifications are not allowed/i.test(failure.error))
	);
}

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
		type: 'projects.create',
		input: {
			id: EMPTY_PROJECT_ID,
			storageSlug: EMPTY_PROJECT_ID,
			name: 'Empty Project',
			createdAt: '2026-07-06T10:00:10.000Z',
			updatedAt: '2026-07-06T10:00:10.000Z',
		},
	});
	await db.request({
		type: 'projects.updateMetadata',
		input: {
			projectId: EMPTY_PROJECT_ID,
			name: 'Renamed Empty Project',
			description: 'Durable empty project',
			charter: 'Keep every witness',
			collationSettings: { segmentation: false },
			updatedAt: '2026-07-06T10:00:20.000Z',
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
		type: 'transcriptions.updateMetadata',
		input: {
			id: TRANSCRIPTION_ID,
			title: 'Witness A Updated',
			siglum: 'A',
			description: 'Durable metadata',
			tags: ['invariant'],
			transcriber: 'Editor Updated',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
			updatedAt: '2026-07-06T10:02:10.000Z',
		},
	});
	const manifestSource = await db.request<{ id: string }>({
		type: 'iiif.ensureManifestSource',
		input: {
			transcriptionId: TRANSCRIPTION_ID,
			manifestUrl: 'https://example.test/manifest',
			label: 'Durable manuscript',
		},
	});
	await db.request({
		type: 'iiif.upsertPageCanvasLink',
		input: {
			transcriptionId: TRANSCRIPTION_ID,
			pageId: 'page-1',
			pageNameSnapshot: 'Page 1',
			pageOrder: 0,
			manifestSourceId: manifestSource.id,
			manifestUrlSnapshot: 'https://example.test/manifest',
			canvasId: 'https://example.test/canvas/1',
			canvasOrder: 0,
			canvasLabel: 'Canvas 1',
			imageServiceUrl: null,
			thumbnailUrl: null,
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
		type: 'collations.saveArtifact',
		input: {
			collationId: COLLATION_ID,
			artifactId: 'col-working-artifact',
			artifactType: 'collation_document_v1',
			payload: JSON.stringify({
				type: 'collationDocument',
				version: 1,
				meta: {
					collationId: COLLATION_ID,
					projectId: PROJECT_ID,
					projectName: 'Delete Index Invariant',
				},
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
					selectedVerseNum: '2',
					witnesses: [
						{
							type: 'witness',
							id: 'A',
							siglum: 'A',
							transcriptionId: TRANSCRIPTION_ID,
							sourceVersion: 'tx-initial-checkpoint',
							content: 'εν αρχη',
							treatment: 'full',
							isBaseText: true,
							isExcluded: false,
							overridesDefault: false,
							sourceTokens: [
								{
									kind: 'text',
									original: 'εν',
									segments: [],
									gap: null,
									tokenId: 'A::source::0',
									sourceRef: {
										witnessId: 'A',
										transcriptionId: TRANSCRIPTION_ID,
										index: 0,
									},
								},
							],
						},
					],
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
				alignment: {
					type: 'alignment',
					witnessOrder: ['A'],
					columns: [
						{
							id: 'alignment-column-1',
							index: 0,
							merged: false,
							cells: [
								['A', alignmentCell('εν', 'A::source::0')],
								['B', alignmentCell('αρχη', 'B::source::0')],
							],
						},
					],
				},
				apparatus: {
					type: 'apparatus',
					units: [
						{
							type: 'variationUnit',
							id: 'unit:alignment-column-1',
							unitIndex: 0,
							columnId: 'alignment-column-1',
							readings: [classifiedReading('reading-a', 'εν', ['A'])],
						},
					],
				},
				stemma: null,
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
	await db.request({
		type: 'projects.create',
		input: { id: COPY_PROJECT_ID, storageSlug: COPY_PROJECT_ID, name: 'Copy Target' },
	});
	await db.request({
		type: 'projects.addTranscriptionFromProject',
		input: {
			targetProjectId: COPY_PROJECT_ID,
			sourceProjectTranscriptionId: PROJECT_TRANSCRIPTION_ID,
			createdAt: '2026-07-06T10:06:00.000Z',
		},
	});
	await db.request({
		type: 'projects.fork',
		input: {
			sourceProjectId: PROJECT_ID,
			name: 'Invariant Fork',
			createdAt: '2026-07-06T10:07:00.000Z',
		},
	});
	await db.request({
		type: 'transcriptions.create',
		input: {
			id: DELETED_TRANSCRIPTION_ID,
			projectId: PROJECT_ID,
			projectTranscriptionId: 'pt-deleted-index-invariant',
			title: 'Deleted witness',
			siglum: 'D',
			document: documentWithVerse('Romans 1:3'),
			transcriber: '',
			repository: '',
			settlement: '',
			language: 'grc',
		},
	});
	await db.request({
		type: 'revisions.commitTranscription',
		input: {
			projectTranscriptionId: 'pt-deleted-index-invariant',
			checkpointId: 'deleted-checkpoint',
			commitMessage: 'Before deletion',
			createdAt: '2026-07-06T10:08:00.000Z',
		},
	});
	await db.request({ type: 'transcriptions.delete', transcriptionId: DELETED_TRANSCRIPTION_ID });
}

function alignmentCell(text: string, sourceTokenId: string) {
	return {
		text,
		regularizedText: text,
		alignmentValue: text,
		sourceTokenIds: [sourceTokenId],
		kind: 'text',
		gap: null,
		isOmission: false,
		isLacuna: false,
		isRegularized: false,
		ruleIds: [],
		regularizationTypes: [],
	};
}

function classifiedReading(id: string, text: string, witnessIds: string[]) {
	return {
		id,
		order: 0,
		label: 'a',
		text,
		normalizedText: text,
		witnessIds,
		witnessGroups: [{ id: `${id}-group`, witnessIds }],
		classification: 'unclassified',
		isOmission: false,
		isLacuna: false,
		readingType: null,
		parentReadingId: null,
		isSubreading: false,
		autoGenerated: false,
		derivedFromRuleIds: [],
	};
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
		emptyProject,
		iiifSources,
		iiifLinks,
		deletedTombstones,
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
		db.request<Record<string, unknown> | null>({ type: 'projects.get', projectId: EMPTY_PROJECT_ID }),
		db.request<Array<Record<string, unknown>>>({
			type: 'iiif.listManifestSources',
			transcriptionId: TRANSCRIPTION_ID,
		}),
		db.request<Array<Record<string, unknown>>>({
			type: 'iiif.listPageCanvasLinks',
			transcriptionId: TRANSCRIPTION_ID,
		}),
		db.request<Array<Record<string, unknown>>>({
			type: 'query',
			sql: 'SELECT entity_id, entity_type, deletion_revision_id FROM sync_tombstones ORDER BY entity_id',
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
		emptyProject,
		allProjects: projects,
		transcriptionSummaries: transcriptionSummaries
			.filter(row => row.id === TRANSCRIPTION_ID)
			.map(row => pick(row, ['id', 'title', 'siglum', 'created_at', 'updated_at'])),
		transcriptionContent: transcription.content_json,
		iiifSources: iiifSources.map(row =>
			pick(row, [
				'id',
				'transcriptionId',
				'manifestUrl',
				'label',
				'sourceKind',
				'defaultCanvasId',
				'defaultImageServiceUrl',
				'metadata',
			])
		),
		iiifLinks: iiifLinks.map(row =>
			pick(row, [
				'id',
				'transcriptionId',
				'pageId',
				'pageNameSnapshot',
				'pageOrder',
				'manifestSourceId',
				'manifestUrlSnapshot',
				'canvasId',
				'canvasOrder',
				'canvasLabel',
				'imageServiceUrl',
				'thumbnailUrl',
				'linkRole',
			])
		),
		deletedTombstones,
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

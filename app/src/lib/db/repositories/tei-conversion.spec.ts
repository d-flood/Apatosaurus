import { DOMParser } from '@xmldom/xmldom';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	createCbgmAnalysisWithFiles,
	createLocalDbTestHarness,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import { readTextFile, writeTextFileAtomic } from '$lib/storage/opfs-store';
import { APP_STORE_ROOT } from '$lib/storage/layout';
import jsonProject from '$lib/storage/legacy-json/fixtures/json-project.json';
import { exportProjectZip } from '$lib/backup/project-zip-export';
import { shouldMirrorProjectFile } from '$lib/backup/project-archive';

import { loadTranscriptionWithWorkingFile } from './transcription-files';
import {
	getCollationVersionStatusWithWorkingFile,
	loadCollationVersionDocument,
	loadCollationWithWorkingFile,
} from './collation-files';
import {
	getProjectTranscriptionCheckpointStatus,
	loadCommittedTranscriptionCheckpointPayload,
	loadTranscriptionContentHash,
} from './revisions';
import { rebuildIndexFromStore } from './index-rebuild';
import { readCurrentCollationHashes } from './cbgm-analyses';
import { convertProjectToTei } from './tei-conversion';

const tamper = vi.hoisted(() => ({ transcription: null as null | ((payload: any) => any) }));
vi.mock('$lib/storage/formats', async importOriginal => {
	const actual = await importOriginal<typeof import('$lib/storage/formats')>();
	return {
		...actual,
		parseTranscriptionTei: (xml: string) => {
			const parsed = actual.parseTranscriptionTei(xml);
			return tamper.transcription ? tamper.transcription(parsed) : parsed;
		},
	};
});

vi.stubGlobal('DOMParser', DOMParser);
vi.stubGlobal('Node', Object.assign(class {}, { ELEMENT_NODE: 1, TEXT_NODE: 3 }));

const PROJECT = `${APP_STORE_ROOT}/projects/project-slug`;
const TRANSCRIPTIONS = ['pt-1', 'pt-2', 'pt-3', 'pt-4'];
const COLLATIONS = ['col-a', 'col-b', 'col-c'];

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;
const storeOptions = () => ({ backend });

// Written by the JSON storage path before TEI became canonical.
const JSON_PROJECT_FILES = jsonProject as Record<string, string>;
const STATE_BEFORE = {
	transcriptions: [
		{ ptid: 'pt-1', commitState: 'clean' },
		{ ptid: 'pt-2', commitState: 'dirty' },
		{ ptid: 'pt-3', commitState: 'never-committed' },
		{ ptid: 'pt-4', commitState: 'never-committed' },
	],
	collations: [
		{ id: 'col-a', commitState: 'clean', witnesses: ['up-to-date'] },
		{ id: 'col-b', commitState: 'dirty', witnesses: ['up-to-date'] },
		{
			id: 'col-c',
			commitState: 'never-committed',
			witnesses: ['up-to-date', 'source-changed'],
		},
	],
	records: [
		['Collation col-a', 'review', ''],
		['Collation col-b', 'review', 'Later notes'],
		['Collation col-c', 'setup', ''],
	],
};

beforeEach(async () => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	await seedJsonProject();
});

afterEach(async () => {
	tamper.transcription = null;
	await harness.destroy();
});

describe('convertProjectToTei', () => {
	it('converts every JSON document once, keeping status, sources and Versions', async () => {
		const progress: Array<{ done: number; total: number; phase?: string }> = [];
		const report = await convertProjectToTei(harness.db, 'project-1', storeOptions(), event =>
			progress.push(event)
		);

		expect(report.failure).toBeUndefined();
		expect(report).toEqual({ status: 'converted', files: 12 });
		expect(progress.filter(event => event.phase === 'conversion').at(-1)).toEqual({
			done: 12,
			total: 12,
			phase: 'conversion',
		});
		expect(progress.at(-1)!.done).toBe(progress.at(-1)!.total);
		expect(await projectState()).toEqual(STATE_BEFORE);

		const manifest = JSON.parse(await read('project.json'));
		expect(manifest.schema_version).toBe(7);
		expect(
			[...manifest.transcriptions, ...manifest.collations].map(head => head.primary_path)
		).toEqual([
			...TRANSCRIPTIONS.map(id => `transcriptions/${id}.tei.xml`),
			...COLLATIONS.map(id => `collations/${id}.tei.xml`),
		]);
		expect(projectPaths().filter(path => path.endsWith('.json') && !isLegacy(path))).toEqual([
			'project.json',
		]);
		expect(projectPaths().filter(isLegacy)).toEqual(
			expect.arrayContaining([
				'legacy/transcriptions/pt-1.json',
				'legacy/history/transcriptions/pt-2/v-2b.json',
				'legacy/collations/col-a.json',
				'legacy/history/collations/col-a/cv-a1.json',
			])
		);
		expect([...backend.files.keys()].some(path => path.includes('upgrades/'))).toBe(false);
	});

	it('keeps every Version verifiable with its note', async () => {
		await convertProjectToTei(harness.db, 'project-1', storeOptions());

		const transcriptionVersions = await harness.db
			.selectFrom('transcription_checkpoints')
			.select(['id', 'transcription_id', 'content_hash', 'commit_message'])
			.orderBy('id')
			.execute();
		expect(transcriptionVersions.map(row => [row.id, row.commit_message])).toEqual([
			['v-1', 'First pass'],
			['v-2a', null],
			['v-2b', 'Corrected 1:2'],
		]);
		for (const row of transcriptionVersions) {
			const version = await loadCommittedTranscriptionCheckpointPayload(
				harness.db,
				row.transcription_id,
				row.id!,
				storeOptions()
			);
			expect(version.commitMessage).toBe(row.commit_message);
		}
		const collationVersions = await harness.db
			.selectFrom('collation_checkpoints')
			.select(['id', 'collation_id', 'commit_message'])
			.orderBy('id')
			.execute();
		expect(collationVersions.map(row => [row.id, row.commit_message])).toEqual([
			['cv-a1', 'Reviewed'],
			['cv-b1', null],
		]);
		for (const row of collationVersions)
			await expect(
				loadCollationVersionDocument(harness.db, row.collation_id, row.id!, storeOptions())
			).resolves.toBeTruthy();
		const fingerprints = await harness.db
			.selectFrom('document_file_fingerprints')
			.select(['entity_id', 'content_hash'])
			.where('entity_type', '=', 'version')
			.execute();
		const versionHashes = new Map(
			[
				...transcriptionVersions,
				...(await harness.db
					.selectFrom('collation_checkpoints')
					.select(['id', 'content_hash'])
					.execute()),
			].map(row => [row.id, row.content_hash])
		);
		expect(fingerprints).toHaveLength(5);
		for (const row of fingerprints)
			expect(row.content_hash).toBe(versionHashes.get(row.entity_id));
	});

	it('carries IIIF links, annotations and origins across', async () => {
		await convertProjectToTei(harness.db, 'project-1', storeOptions());

		expect(await countRows('iiif_manifest_sources')).toBe(1);
		expect(await countRows('transcription_page_canvas_links')).toBe(1);
		expect(await countRows('iiif_canvas_annotations')).toBe(1);
		const copied = (await loadTranscriptionWithWorkingFile(
			harness.db,
			'tx-3',
			storeOptions()
		))!;
		expect([copied.origin_project_id, copied.origin_content_hash]).toEqual([
			'other-project',
			'sha256:other-project-hash',
		]);
		const inProject = (await loadTranscriptionWithWorkingFile(
			harness.db,
			'tx-4',
			storeOptions()
		))!;
		expect(inProject.origin_content_hash).toBe(
			await loadTranscriptionContentHash(harness.db, 'pt-1')
		);
		expect(inProject.origin_content_hash).toMatch(/^sha256:/);
	});

	it('keeps a CBGM analysis of an unchanged collation current', async () => {
		const segment = { segment_name: 'Romans 1:1' };
		const analysis = await createCbgmAnalysisWithFiles(
			harness.db,
			'project-1',
			{
				collations: [
					{
						collation_id: 'col-a',
						content_hash: JSON.parse(JSON_PROJECT_FILES['project.json']).collations[0]
							.current_revision.content_hash,
						...segment,
					},
				],
				undecidedReadings: [],
			},
			storeOptions()
		);

		await convertProjectToTei(harness.db, 'project-1', storeOptions());

		const recorded = JSON.parse(await read(`cbgm/${analysis.id}.json`)).collations[0];
		const current = await readCurrentCollationHashes(
			harness.db,
			'project-1',
			['col-a'],
			storeOptions()
		);
		expect(recorded.content_hash).toBe(current.hashes['col-a']);
		expect(recorded.content_hash).not.toBe(analysis.collations[0]!.content_hash);
	});

	it('leaves an index equal to a rebuild from files, and legacy/ out of it', async () => {
		await convertProjectToTei(harness.db, 'project-1', storeOptions());
		const live = await indexTables();
		const report = await rebuildIndexFromStore(harness.db, storeOptions());

		expect(report.orphanedFiles).toEqual([]);
		expect(await indexTables()).toEqual(live);
	});

	it('never mirrors legacy/', async () => {
		await convertProjectToTei(harness.db, 'project-1', storeOptions());
		const legacy = projectPaths().filter(isLegacy);

		expect(legacy.length).toBeGreaterThan(0);
		expect(legacy.filter(shouldMirrorProjectFile)).toEqual([]);
		const zip = await exportProjectZip(harness.db, 'project-1', {
			storeOptions: storeOptions(),
		});
		expect(zip.entryPaths.filter(path => path.includes('legacy'))).toEqual([]);
		expect(zip.entryPaths).toContain('transcriptions/pt-1.tei.xml');
	});

	it('stops on a verification mismatch and leaves the project on JSON', async () => {
		const files = new Map(backend.files);
		tamper.transcription = payload =>
			payload.project_transcription_id === 'pt-2' ? { ...payload, title: 'Lost' } : payload;

		const report = await convertProjectToTei(harness.db, 'project-1', storeOptions());

		expect(report.status).toBe('failed');
		expect(report.failure).toMatchObject({
			entity: 'Transcription “Witness 2”',
			path: 'history/transcriptions/pt-2/v-2a.tei.xml',
		});
		expect(report.failure!.difference).toContain('Lost');
		expect(JSON.parse(await read('project.json')).schema_version).toBe(6);
		expect(backend.files).toEqual(files);
	});

	it('starts over after a crash before the manifest commit', async () => {
		backend.failWritePathIncludesOnce = 'project.json';

		await expect(
			convertProjectToTei(harness.db, 'project-1', storeOptions())
		).rejects.toThrow();
		expect(JSON.parse(await read('project.json')).schema_version).toBe(6);
		await rebuildIndexFromStore(harness.db, storeOptions());

		expect(await convertProjectToTei(harness.db, 'project-1', storeOptions())).toMatchObject({
			status: 'converted',
		});
		expect(await projectState()).toEqual(STATE_BEFORE);
	});

	it('finishes moving JSON to legacy/ after a crash past the commit', async () => {
		backend.failWritePathIncludesOnce = 'legacy/collations/col-a.json';
		await expect(
			convertProjectToTei(harness.db, 'project-1', storeOptions())
		).rejects.toThrow();
		expect(projectPaths()).toContain('collations/col-a.json');

		expect(await convertProjectToTei(harness.db, 'project-1', storeOptions())).toEqual({
			status: 'not-needed',
			files: 0,
		});
		expect(projectPaths().filter(path => path.endsWith('.json') && !isLegacy(path))).toEqual([
			'project.json',
		]);
	});
});

async function seedJsonProject(): Promise<void> {
	for (const [path, content] of Object.entries(JSON_PROJECT_FILES))
		await writeTextFileAtomic(`projects/project-slug/${path}`, content, storeOptions());
	await rebuildIndexFromStore(harness.db, storeOptions());
}

async function projectState() {
	return {
		transcriptions: await Promise.all(
			TRANSCRIPTIONS.map(async ptid => ({
				ptid,
				commitState: (await getProjectTranscriptionCheckpointStatus(harness.db, ptid))
					.commitState,
			}))
		),
		collations: await Promise.all(
			COLLATIONS.map(async id => {
				const status = await getCollationVersionStatusWithWorkingFile(
					harness.db,
					id,
					{},
					storeOptions()
				);
				return {
					id,
					commitState: status.commitState,
					witnesses: status.witnesses.map(witness => witness.versionState),
				};
			})
		),
		records: await Promise.all(
			COLLATIONS.map(async id => {
				const { row } = (await loadCollationWithWorkingFile(
					harness.db,
					id,
					storeOptions()
				))!;
				return [row.title, row.status, row.notes];
			})
		),
	};
}

async function indexTables() {
	const tables: Array<[string, string[]]> = [
		['transcriptions', []],
		['project_transcriptions', []],
		['transcription_checkpoints', []],
		['transcription_verse_index', ['id', 'last_indexed_at']],
		['transcription_slice_chunks', []],
		['collations', []],
		['collation_checkpoints', []],
		['collation_witnesses', ['id']],
		['document_file_fingerprints', []],
		['iiif_manifest_sources', []],
		['transcription_page_canvas_links', []],
		['iiif_canvas_annotations', []],
	];
	const snapshot: Record<string, unknown[]> = {};
	for (const [table, omitted] of tables) {
		const { rows } = await sql<
			Record<string, unknown>
		>`select * from ${sql.table(table)}`.execute(harness.db);
		snapshot[table] = rows
			.map(row =>
				Object.fromEntries(Object.entries(row).filter(([key]) => !omitted.includes(key)))
			)
			.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
	}
	return snapshot;
}

async function countRows(table: string): Promise<number> {
	const result = await sql
		.raw<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
		.execute(harness.db);
	return Number(result.rows[0]!.count);
}

function projectPaths(): string[] {
	return [...backend.files.keys()]
		.filter(path => path.startsWith(`${PROJECT}/`))
		.map(path => path.slice(PROJECT.length + 1))
		.sort();
}

function isLegacy(path: string): boolean {
	return path.startsWith('legacy/');
}

function read(path: string): Promise<string> {
	return readTextFile(`projects/project-slug/${path}`, storeOptions());
}

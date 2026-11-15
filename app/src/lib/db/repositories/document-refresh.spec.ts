import {
	createCollationWithFiles,
	createLocalDbTestHarness,
	createTranscriptionWithFiles,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/transcription/content';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import { readTextFile, writeTextFileAtomic } from '$lib/storage/opfs-store';
import { APP_STORE_ROOT, joinStorePath } from '$lib/storage/layout';
import { prepareWitnessesFromDocument } from '$lib/collation/collation-runner';

import { verseMilestones } from './verse-milestones.spec-support';
import { DocumentFileProblemError } from './document-fingerprints';
import { listDocumentFileProblems, refreshChangedDocumentFiles } from './document-refresh';
import { createProject } from './projects';
import {
	createCommittedCollationCheckpointWithFiles,
	loadCollationWithWorkingFile,
	saveWorkingCollationMetadata,
} from './collation-files';
import {
	createCommittedTranscriptionCheckpointWithFiles,
	saveWorkingTranscriptionContent,
} from './transcription-files';
import { getCurrentVerseSources, getTranscriptionSummary } from './transcriptions';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;
const storeOptions = () => ({ backend });
const CURRENT = 'projects/project-slug/transcriptions/pt-1.tei.xml';

beforeEach(async () => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	await createProject(
		harness.db,
		{ id: 'project-1', storageSlug: 'project-slug', name: 'Project' },
		storeOptions()
	);
	for (const n of [1, 2]) {
		await createTranscriptionWithFiles(
			harness.db,
			{
				id: `tx-${n}`,
				projectId: 'project-1',
				projectTranscriptionId: `pt-${n}`,
				title: `Witness ${n}`,
				siglum: `0${n}`,
				document: documentWithText('paulos doulos'),
				transcriber: '',
				repository: '',
				settlement: '',
				language: 'grc',
			},
			storeOptions()
		);
	}
	await createCommittedTranscriptionCheckpointWithFiles(
		harness.db,
		{ projectTranscriptionId: 'pt-1', checkpointId: 'v-1', label: 'First' },
		storeOptions()
	);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await harness.destroy();
});

describe('refreshChangedDocumentFiles', () => {
	it('opens an unchanged project without hashing any file', async () => {
		const digests = countTeiDigests();

		const report = await refresh();

		expect(report.checked).toBe(5);
		expect(digests()).toBe(0);
	});

	it('hashes a touched but identical file once and does not re-parse it', async () => {
		backend.touch(joinStorePath(APP_STORE_ROOT, CURRENT));
		const digests = countTeiDigests();

		const report = await refresh();
		const again = await refresh();

		expect(digests()).toBe(1);
		expect(report.hashed).toBe(1);
		expect(report.reindexedPaths).toEqual([]);
		expect(again.hashed).toBe(0);
	});

	it('re-parses an edited file so gather returns the new text', async () => {
		const xml = await readTextFile(CURRENT, storeOptions());
		await writeTextFileAtomic(CURRENT, xml.replace('doulos', 'apostolos'), storeOptions());

		const report = await refresh();

		expect(report.reindexedPaths).toEqual(['transcriptions/pt-1.tei.xml']);
		expect(await gatheredText('tx-1')).toBe('paulos apostolos');
		expect(await gatheredText('tx-2')).toBe('paulos doulos');
		expect((await refresh()).hashed).toBe(0);
	});

	it('indexes a new Version file that has no fingerprint', async () => {
		const versionPath = 'projects/project-slug/history/transcriptions/pt-1/v-1.tei.xml';
		const version = await readTextFile(versionPath, storeOptions());
		await harness.db.deleteFrom('transcription_checkpoints').where('id', '=', 'v-1').execute();
		await harness.db
			.deleteFrom('document_file_fingerprints')
			.where('entity_id', '=', 'v-1')
			.execute();
		expect(await readTextFile(versionPath, storeOptions())).toBe(version);

		const report = await refresh();

		expect(report.reindexedPaths).toEqual(['history/transcriptions/pt-1/v-1.tei.xml']);
		expect(
			await harness.db
				.selectFrom('transcription_checkpoints')
				.select('label')
				.where('id', '=', 'v-1')
				.executeTakeFirst()
		).toEqual({ label: 'First' });
	});

	it('reports a broken file with invalid_tei, keeps its old rows and never rewrites it', async () => {
		const good = await readTextFile(CURRENT, storeOptions());
		const broken = good.replace('</text>', '');
		await writeTextFileAtomic(CURRENT, broken, storeOptions());

		const report = await refresh();

		expect(report.problems).toMatchObject([
			{
				path: 'transcriptions/pt-1.tei.xml',
				code: 'invalid_tei',
				entityId: 'pt-1',
				transcriptionId: 'tx-1',
				title: 'Witness 1',
			},
		]);
		expect(report.problems[0]?.message).toMatch(/text/);
		expect((await getTranscriptionSummary(harness.db, 'tx-1'))?.title).toBe('Witness 1');
		expect(await gatheredText('tx-1')).toBe('paulos doulos');
		await expect(
			saveWorkingTranscriptionContent(
				harness.db,
				{ id: 'tx-1', document: documentWithText('overwritten') },
				storeOptions()
			)
		).rejects.toBeInstanceOf(DocumentFileProblemError);
		await expect(
			createCommittedTranscriptionCheckpointWithFiles(
				harness.db,
				{ projectTranscriptionId: 'pt-1' },
				storeOptions()
			)
		).rejects.toBeInstanceOf(DocumentFileProblemError);
		expect(await readTextFile(CURRENT, storeOptions())).toBe(broken);
		const digests = countTeiDigests();
		expect((await refresh()).hashed).toBe(0);
		expect(digests()).toBe(0);

		await writeTextFileAtomic(CURRENT, good, storeOptions());
		const fixed = await refresh();

		expect(fixed.problems).toEqual([]);
		expect(await listDocumentFileProblems(harness.db, 'project-1')).toEqual([]);
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithText('saved again') },
			storeOptions()
		);
		expect(await gatheredText('tx-1')).toBe('saved again');
	});
});

describe('refreshChangedDocumentFiles with a TEI-canonical collation', () => {
	const COLLATION = 'projects/project-slug/collations/col-1.tei.xml';
	const loadCollation = () => loadCollationWithWorkingFile(harness.db, 'col-1', storeOptions());

	beforeEach(async () => {
		await createCollationWithFiles(
			harness.db,
			{
				id: 'col-1',
				projectId: 'project-1',
				title: 'Romans 1:1',
				verseIdentifier: 'Romans 1:1',
				segment: { id: 'segment-1', name: 'Romans 1:1', members: ['Romans 1:1'] },
			},
			storeOptions()
		);
		await saveWorkingCollationMetadata(
			harness.db,
			{ id: 'col-1', notes: 'Original note' },
			storeOptions()
		);
	});

	it('re-parses a collation edited outside the app', async () => {
		const xml = await readTextFile(COLLATION, storeOptions());
		await writeTextFileAtomic(
			COLLATION,
			xml.replace(
				'<f name="notes"><string>Original note</string></f>',
				'<f name="notes"><string>Edited in Oxygen</string></f>'
			),
			storeOptions()
		);

		const report = await refresh();

		expect(report.reindexedPaths).toEqual(['collations/col-1.tei.xml']);
		expect((await loadCollation())?.row.notes).toBe('Edited in Oxygen');
		expect((await refresh()).hashed).toBe(0);
	});

	it('reports an unparseable collation, keeps its old rows and blocks saving', async () => {
		const good = await readTextFile(COLLATION, storeOptions());
		const broken = good.replace('</standOff>', '');
		await writeTextFileAtomic(COLLATION, broken, storeOptions());

		const report = await refresh();

		expect(report.problems).toMatchObject([
			{
				path: 'collations/col-1.tei.xml',
				code: 'invalid_tei',
				entityType: 'collation',
				entityId: 'col-1',
				title: 'Romans 1:1',
			},
		]);
		expect((await loadCollation())?.row.notes).toBe('Original note');
		await expect(
			saveWorkingCollationMetadata(harness.db, { id: 'col-1', notes: 'Lost' }, storeOptions())
		).rejects.toBeInstanceOf(DocumentFileProblemError);
		await expect(
			createCommittedCollationCheckpointWithFiles(
				harness.db,
				{ collationId: 'col-1' },
				storeOptions()
			)
		).rejects.toBeInstanceOf(DocumentFileProblemError);
		expect(await readTextFile(COLLATION, storeOptions())).toBe(broken);

		await writeTextFileAtomic(COLLATION, good, storeOptions());
		expect((await refresh()).problems).toEqual([]);
		await saveWorkingCollationMetadata(
			harness.db,
			{ id: 'col-1', notes: 'Saved again' },
			storeOptions()
		);
		expect((await loadCollation())?.row.notes).toBe('Saved again');
	});

	it('indexes a collation Version file that has no fingerprint', async () => {
		const head = await harness.db
			.selectFrom('collations')
			.select('current_revision_id')
			.executeTakeFirstOrThrow();
		await harness.db.deleteFrom('collation_checkpoints').execute();
		await harness.db
			.deleteFrom('document_file_fingerprints')
			.where('entity_id', '=', head.current_revision_id)
			.execute();

		const report = await refresh();

		expect(report.reindexedPaths).toEqual([
			`history/collations/col-1/${head.current_revision_id}.tei.xml`,
		]);
		expect(await harness.db.selectFrom('collation_checkpoints').select('id').execute()).toEqual(
			[{ id: head.current_revision_id }]
		);
	});
});

// Manifest reads verify their seal; count only SHA-256s over TEI bytes.
function countTeiDigests(): () => number {
	const digest = vi.spyOn(globalThis.crypto.subtle, 'digest');
	return () =>
		digest.mock.calls.filter(([, data]) =>
			new TextDecoder().decode(data as Uint8Array).includes('<TEI')
		).length;
}

function refresh() {
	return refreshChangedDocumentFiles(harness.db, 'project-1', storeOptions());
}

async function gatheredText(transcriptionId: string): Promise<string> {
	const [source] = await getCurrentVerseSources(harness.db, 'Romans 1:1', [transcriptionId]);
	const [witness] = prepareWitnessesFromDocument({
		document: source!.document,
		verseIdentifier: 'Romans 1:1',
		transcriptionId,
		siglum: source!.siglum,
		source: {
			kind: 'current',
			transcriptionId,
			capturedAt: '',
			contentHash: source!.contentHash,
		},
	});
	return witness?.content ?? '';
}

function documentWithText(text: string): StoredTranscriptionDocument {
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
								items: [...verseMilestones(['Romans 1:1']), { type: 'text', text }],
							},
						],
					},
				],
			},
		],
	};
}

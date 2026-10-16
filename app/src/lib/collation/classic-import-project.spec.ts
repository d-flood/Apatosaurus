import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollationDocument } from './collation-document';
import { importClassicCollationProject } from './classic-import-project';
import { parseClassicCollationExport, buildClassicBaseTranscription } from './classic-import';
import { collationState } from './collation-state.svelte';

const { db } = vi.hoisted(() => ({
	db: {
		getProject: vi.fn(),
		createTranscription: vi.fn(),
		getTranscriptionsByIds: vi.fn(),
		getTranscriptionCurrentContentHashes: vi.fn(),
		getVerseIndexRowsForVerse: vi.fn(),
		listVerseIndexRowsForTranscriptions: vi.fn(),
		getProjectTranscriptionIds: vi.fn(),
		createCollation: vi.fn(),
		saveCollationArtifact: vi.fn(),
		updateCollationMetadata: vi.fn(),
		updateProjectMetadata: vi.fn(),
		deleteCollation: vi.fn(),
		deleteTranscription: vi.fn(),
		loadCollation: vi.fn(),
	},
}));
vi.mock('$lib/db/client', () => db);
vi.stubGlobal('DOMParser', DOMParser);

const defaults = {
	transcriber: 'Editor',
	repository: 'Library',
	settlement: 'Cambridge',
	language: 'Greek',
};
const fixture = readFileSync(new URL('./__fixtures__/classic/core.xml', import.meta.url), 'utf8');
let saved: CollationDocument[];
let records: Array<{ id: string; siglum: string; content_json: string }>;

function indexRows() {
	return records.flatMap(record => {
		const document = JSON.parse(record.content_json);
		return document.pages.flatMap(
			(page: {
				columns: Array<{
					lines: Array<{ items: Array<{ type: string; attrs?: { book: string } }> }>;
				}>;
			}) =>
				page.columns.flatMap(column =>
					column.lines.flatMap(line =>
						line.items
							.filter(item => item.type === 'milestone')
							.map(item => ({
								transcription_id: record.id,
								verse_identifier: item.attrs!.book,
								book: item.attrs!.book,
								chapter: '',
								verse: '',
							}))
					)
				)
		);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	saved = [];
	records = [];
	collationState.reset();
	db.getProject.mockResolvedValue({
		id: 'project',
		name: 'Project',
		collationSettings: { ignoreWordBreaks: true, ignorePunctuation: true, lowercase: true },
	});
	db.updateProjectMetadata.mockImplementation(async input => {
		const project = await db.getProject();
		db.getProject.mockResolvedValue({ ...project, collationSettings: input.collationSettings });
	});
	db.createTranscription.mockImplementation(async input => {
		const id = `tx-${records.length}`;
		records.push({ id, siglum: input.siglum, content_json: input.contentJson });
		return id;
	});
	db.getTranscriptionsByIds.mockImplementation(async ids =>
		records.filter(record => ids.includes(record.id))
	);
	db.getTranscriptionCurrentContentHashes.mockImplementation(async ids =>
		Object.fromEntries(ids.map((id: string) => [id, 'hash']))
	);
	db.getVerseIndexRowsForVerse.mockImplementation(async (verse, ids) =>
		indexRows().filter(
			row => row.verse_identifier === verse && (!ids || ids.includes(row.transcription_id))
		)
	);
	db.listVerseIndexRowsForTranscriptions.mockImplementation(async ids =>
		indexRows().filter(row => ids.includes(row.transcription_id))
	);
	db.getProjectTranscriptionIds.mockImplementation(async () => records.map(record => record.id));
	db.createCollation.mockImplementation(async input => input.id);
	db.saveCollationArtifact.mockImplementation(async input => {
		saved.push(JSON.parse(input.payload));
		return 'artifact';
	});
	db.loadCollation.mockImplementation(async id => ({
		row: { id, projectId: 'project' },
		artifact: {
			id: 'artifact',
			payload: JSON.stringify(saved.find(document => document.meta.collationId === id)),
		},
	}));
});
afterEach(() => collationState.reset());

describe('classic import into a project', () => {
	it('persists one base transcription and each verse, then places a new transcription through an added segment member', async () => {
		const source = parseClassicCollationExport(fixture);
		await importClassicCollationProject({
			projectId: 'project',
			source,
			baseSiglum: 'A',
			title: 'Classic base',
			defaults,
		});
		expect(db.createTranscription).toHaveBeenCalledOnce();
		expect(saved.map(document => document.setup.segment.members)).toEqual([
			['Acts_1.1'],
			['Unnormalized.verse_2'],
		]);
		expect(db.updateCollationMetadata).toHaveBeenCalledTimes(2);
		expect(await collationState.loadCollationById(saved[1].meta.collationId!)).toBe(true);
		expect(collationState.ignoreWordBreaks).toBe(false);
		expect(collationState.ignorePunctuation).toBe(false);
		const span = collationState.getVariationUnitSpans()[0];
		const imported = collationState
			.peekReadingsForUnit(span.unitId)
			.find(reading => reading.text === 'θεος')!;
		expect(imported).toBeDefined();
		const before = collationState.alignmentColumns.map(column => column.id);
		await db.createTranscription({
			siglum: 'New',
			contentJson: JSON.stringify(
				buildClassicBaseTranscription({
					witnesses: [],
					verses: [{ id: 'Acts 1:2', baseWords: ['θεος', 'εστιν'], units: [] }],
				})
			),
		});
		collationState.setSegmentMembers(['Unnormalized.verse_2', 'Acts 1:2']);
		expect(await collationState.refreshWitnessesFromSource()).toBe(true);
		expect(collationState.alignmentColumns.map(column => column.id)).toEqual(before);
		const placed = collationState
			.peekReadingsForUnit(span.unitId)
			.find(reading => reading.id === imported.id)!;
		expect(placed.witnessIds).toContain('New');
		expect(placed.manualWitnessIds).toHaveLength(2);
		expect(collationState.peekUnitView(span.unitId).unconfirmedWitnessIds).toEqual(['New']);
		expect(collationState.phase).toBe('review');
		expect(collationState.furthestPhase).toBe('review');
	});

	it('refuses a noncandidate siglum before writing anything', async () => {
		await expect(
			importClassicCollationProject({
				projectId: 'project',
				source: parseClassicCollationExport(fixture),
				baseSiglum: 'B',
				title: 'Base',
				defaults,
			})
		).rejects.toThrow('agrees');
		expect(db.createTranscription).not.toHaveBeenCalled();
		expect(db.createCollation).not.toHaveBeenCalled();
	});
});

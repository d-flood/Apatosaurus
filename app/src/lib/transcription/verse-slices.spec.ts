import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { prepareWitnessesFromDocument } from '$lib/collation/collation-runner';
import {
	getCurrentVerseSources,
	listVerseIndexRowsForTranscription,
} from '$lib/db/repositories/transcriptions';
import { createProject } from '$lib/db/repositories/projects';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import {
	createLocalDbTestHarness,
	createTranscriptionWithFiles,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { importTEIDocument } from '$lib/tei/tei-importer';
import { coerceTranscriptionDocument, type StoredTranscriptionDocument } from './content';
import { sliceDocumentByVerse } from './verse-slices';

beforeAll(() => {
	if (typeof globalThis.DOMParser === 'undefined') {
		(globalThis as any).DOMParser = DOMParser;
	}
	if (typeof globalThis.Node === 'undefined') {
		(globalThis as any).Node = Object.assign(class {}, {
			ELEMENT_NODE: 1,
			TEXT_NODE: 3,
			CDATA_SECTION_NODE: 4,
			PROCESSING_INSTRUCTION_NODE: 7,
			COMMENT_NODE: 8,
			DOCUMENT_NODE: 9,
			DOCUMENT_TYPE_NODE: 10,
			DOCUMENT_FRAGMENT_NODE: 11,
		});
	}
});

const transcriptions = fileURLToPath(
	new URL('../../../static/igntp/Romans_Greek_transcriptions/', import.meta.url)
);

const corpusFiles = process.env.IGNTP_SLICES_ALL
	? readdirSync(transcriptions).filter(file => file.endsWith('.xml'))
	: ['02', '04', '0150', '1319', '1739', '1909', 'L60', 'L1126', 'P46'].map(
			witness => `NT_GRC_${witness}_Rom.xml`
		);

function loadIgntp(name: string): StoredTranscriptionDocument {
	const path = `${transcriptions}${name}`;
	const document = coerceTranscriptionDocument(importTEIDocument(readFileSync(path, 'utf8')));
	if (!document) throw new Error(`Could not load ${name}`);
	return document;
}

function verseIdentifiers(document: StoredTranscriptionDocument): string[] {
	const identifiers = new Set<string>();
	const state = { book: '', chapter: '', verse: '' };
	for (const page of document.pages)
		for (const column of page.columns)
			for (const line of column.lines)
				for (const item of line.items) {
					if (item.type !== 'milestone' || item.kind !== 'verse') continue;
					state.book = item.attrs.book || state.book;
					state.chapter = item.attrs.chapter || state.chapter;
					state.verse = item.attrs.verse || state.verse;
					identifiers.add(`${state.book} ${state.chapter}:${state.verse}`);
				}
	return [...identifiers];
}

function prepare(
	document: StoredTranscriptionDocument,
	verseIdentifier: string,
	ignoreWordBreaks: boolean
) {
	return prepareWitnessesFromDocument({
		document,
		verseIdentifier,
		transcriptionId: 't1',
		siglum: 'W',
		source: { kind: 'current', transcriptionId: 't1', capturedAt: '', contentHash: '' },
		options: { ignoreWordBreaks },
	});
}

function expectSlicesMatchDocument(document: StoredTranscriptionDocument, identifiers: string[]) {
	const slices = sliceDocumentByVerse(document, identifiers);
	for (const identifier of identifiers) {
		const slice = { ...document, pages: slices.get(identifier) ?? [] };
		for (const ignoreWordBreaks of [false, true])
			expect(
				prepare(slice, identifier, ignoreWordBreaks),
				`${identifier} ignoreWordBreaks=${ignoreWordBreaks}`
			).toEqual(prepare(document, identifier, ignoreWordBreaks));
	}
}

const verse = (chapter: string, verse: string) => ({
	type: 'milestone' as const,
	kind: 'verse' as const,
	attrs: { book: 'Rom', chapter, verse },
});
const text = (value: string) => ({ type: 'text' as const, text: value });
const line = (number: number, items: unknown[], wrapped = false) => ({
	type: 'line' as const,
	number,
	wrapped,
	items,
});

async function expectStoredSlicesMatchDocument(
	harness: LocalDbTestHarness,
	backend: MemoryStoreBackend,
	document: StoredTranscriptionDocument
): Promise<number> {
	const id = await createTranscriptionWithFiles(
		harness.db,
		{
			projectId: 'project-1',
			title: 'Witness',
			siglum: 'W',
			document,
			transcriber: '',
			repository: '',
			settlement: '',
			language: 'grc',
		},
		{ backend }
	);
	const identifiers = (await listVerseIndexRowsForTranscription(harness.db, id)).map(
		row => row.verse_identifier
	);
	const { content_json } = harness.sqlite
		.prepare('SELECT content_json FROM transcriptions WHERE id = ?')
		.get(id) as { content_json: string };
	const stored = coerceTranscriptionDocument(content_json)!;
	const slices = sliceDocumentByVerse(stored, identifiers);
	for (const identifier of identifiers) {
		const [source] = await getCurrentVerseSources(harness.db, identifier, [id]);
		expect(source.document, identifier).toEqual({ ...stored, pages: slices.get(identifier) });
	}
	return identifiers.length;
}

describe('stored verse slices', () => {
	let harness: LocalDbTestHarness;
	let backend: MemoryStoreBackend;

	beforeEach(async () => {
		harness = createLocalDbTestHarness();
		backend = new MemoryStoreBackend();
		await createProject(
			harness.db,
			{ id: 'project-1', storageSlug: 'project-1', name: 'Project' },
			{ backend }
		);
	});

	afterEach(async () => {
		await harness.destroy();
	});

	it.each(corpusFiles)(
		'gathers every verse of %s exactly as sliceDocumentByVerse slices it',
		async file => {
			expect(
				await expectStoredSlicesMatchDocument(harness, backend, loadIgntp(file))
			).toBeGreaterThan(0);
		},
		120_000
	);
});

describe('sliceDocumentByVerse', () => {
	it('matches whole-document extraction for every verse of a corrected lectionary', () => {
		const document = loadIgntp('NT_GRC_L60_Rom.xml');
		expectSlicesMatchDocument(document, verseIdentifiers(document));
	}, 30_000);

	it('matches whole-document extraction for every verse of a lacunose papyrus', () => {
		const document = loadIgntp('NT_GRC_P46_Rom.xml');
		expectSlicesMatchDocument(document, verseIdentifiers(document));
	}, 30_000);

	it('keeps wrapped breaks, empty columns and mid-line starts inside a verse', () => {
		const document = coerceTranscriptionDocument({
			type: 'transcriptionDocument',
			pages: [
				{
					type: 'page',
					id: 'p1',
					columns: [
						{
							type: 'column',
							number: 1,
							lines: [
								line(1, [verse('1', '1'), text('αρχη')]),
								line(2, [text('τελος '), verse('1', '2'), text('παυλος δου')]),
							],
						},
						{ type: 'column', number: 2, wrapped: true, lines: [] },
					],
				},
				{
					type: 'page',
					id: 'p2',
					wrapped: true,
					columns: [
						{
							type: 'column',
							number: 1,
							wrapped: true,
							lines: [
								line(1, [text('λος χριστου')], true),
								line(2, [verse('1', '3'), text('περι')]),
								line(3, [verse('1', '2'), text('αυθις')]),
							],
						},
					],
				},
			],
		});
		if (!document) throw new Error('Invalid test document');
		expectSlicesMatchDocument(document, ['Rom 1:1', 'Rom 1:2', 'Rom 1:3']);
		expect(prepare(document, 'Rom 1:2', false)[0]?.content).toContain('δου');
	});
});

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { getSchema } from '@tiptap/core';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
	createLocalDbTestHarness,
	createTranscriptionWithFiles,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import { parseTranscriptionTei } from '$lib/storage/formats';
import { readTextFile } from '$lib/storage/opfs-store';
import { joinStorePath, projectFolder } from '$lib/storage/layout';
import { documentCanonicalPath } from '$lib/storage/document-files';
import { importTEIDocument } from '$lib/tei/tei-importer';
import { createPageConversionCache } from '$lib/editor/page-conversion-cache';
import { getProfileExtensions } from '$lib/editor/schema/index';
import { prepareManuscriptDocumentEntry } from '$lib/editor/structure';
import {
	coerceTranscriptionDocument,
	mergeWithCanonicalDocument,
	type StoredTranscriptionDocument,
} from '$lib/transcription/content';
import { toProseMirror, type LineItem, type TextMark } from '@apatosaurus/tei-transcription';

import { createProject } from './projects';
import { rebuildIndexFromStore, transcriptionIndexRowsFromPrimary } from './index-rebuild';
import {
	ensureManifestSourceWithFiles,
	upsertCanvasAnnotationWithFiles,
	upsertPageCanvasLinkWithFiles,
} from './iiif-files';
import {
	saveWorkingTranscriptionContent,
	verifyTranscriptionIndexRows,
} from './transcription-files';
import { verseMilestones } from './verse-milestones.spec-support';

const codec = vi.hoisted(() => ({ rewrite: null as ((xml: string) => string) | null }));

vi.mock('$lib/storage/formats', async importOriginal => {
	const actual = await importOriginal<typeof import('$lib/storage/formats')>();
	const { hashContent } = await import('$lib/storage/content-hash');
	const { teiContentHash } = await import('$lib/storage/tei-content');
	return {
		...actual,
		async serializeTranscriptionTeiWithRecord(
			...args: Parameters<typeof actual.serializeTranscriptionTeiWithRecord>
		) {
			const result = await actual.serializeTranscriptionTeiWithRecord(...args);
			if (!codec.rewrite) return result;
			const xml = codec.rewrite(result.xml);
			return {
				...result,
				xml,
				fileHash: await hashContent(xml),
				contentHash: await teiContentHash(xml),
			};
		},
	};
});

const PROJECT_ID = 'project-1';
const PROJECT_SLUG = 'romans';
const TRANSCRIPTION_ID = 'tx-1';
const PROJECT_TRANSCRIPTION_ID = 'pt-1';

const transcriptions = fileURLToPath(
	new URL('../../../../static/igntp/Romans_Greek_transcriptions/', import.meta.url)
);
const corpusFiles = process.env.IGNTP_ROWS_ALL
	? readdirSync(transcriptions).filter(file => file.endsWith('.xml'))
	: ['L60', 'P26', 'P46', '2006'].map(witness => `NT_GRC_${witness}_Rom.xml`);
const editorSchema = getSchema(getProfileExtensions('main-manuscript'));

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;

beforeAll(() => {
	if (typeof globalThis.DOMParser === 'undefined') (globalThis as any).DOMParser = DOMParser;
	if (typeof globalThis.Node === 'undefined')
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
});

beforeEach(async () => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	codec.rewrite = null;
	await createProject(
		harness.db,
		{
			id: PROJECT_ID,
			storageSlug: PROJECT_SLUG,
			name: 'Romans',
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		},
		{ backend }
	);
});

afterEach(async () => {
	await harness.destroy();
});

describe('payload-built transcription index rows', () => {
	it.each(corpusFiles)(
		'equal the rows parsed from the written TEI for %s',
		{ timeout: 120_000 },
		async name => {
			const document = coerceTranscriptionDocument(
				importTEIDocument(readFileSync(`${transcriptions}${name}`, 'utf8'))
			);
			if (!document) throw new Error(`Could not load ${name}`);
			await createRichTranscription({
				...document,
				referenceEditionsUsed: ['NA28', 'TR'],
				referenceEditionAttributions: { NA28: 'Nestle–Aland 28th edition' },
			});

			await saveWorkingTranscriptionContent(
				harness.db,
				{
					id: TRANSCRIPTION_ID,
					document: editLikeTheEditor(await storedDocument()),
					updatedAt: '2026-07-05T00:00:00.000Z',
				},
				{ backend }
			);

			await expectRowsMatchFile();
			expect(
				await verifyTranscriptionIndexRows(harness.db, TRANSCRIPTION_ID, { backend })
			).toMatchObject({ status: 'verified', warnings: [] });
			expect(await rowsVerified()).toBe(1);
		}
	);

	const text = (value: string, ...marks: TextMark[]): Extract<LineItem, { type: 'text' }> => ({
		type: 'text',
		text: value,
		marks,
	});
	const space: LineItem = { type: 'boundary', kind: 'word' };
	const punctuation: TextMark = { type: 'punctuation', attrs: {} };
	const correction: TextMark = {
		type: 'correction',
		attrs: {
			corrections: [
				{ hand: 'corrector', content: [text('alfa')], readingAttrs: { type: 'corr' } },
			],
		},
	};
	const milestone = (kind: 'chapter' | 'verse', chapter: string, verse?: string): LineItem => ({
		type: 'milestone',
		kind,
		attrs: { book: 'Romans', chapter, ...(verse ? { verse } : {}) },
	});
	it.each<[string, TypedLine[]]>([
		['typing a blank line between two text lines', [[text('alpha')], [], [text('beta')]]],
		[
			'typing punctuation, a space and a word',
			[[text('alpha'), text('.', punctuation), space, text('beta')]],
		],
		[
			'inserting a verse milestone at a word end',
			[[text('alpha'), milestone('verse', '1', '2'), space, text('beta')]],
		],
		[
			'ending a line with a chapter milestone',
			[
				[text('alpha'), milestone('chapter', '2')],
				[milestone('verse', '2', '1'), text('beta')],
			],
		],
		[
			'typing a letter before a corrected word',
			[[text('beta'), space, text('x'), text('alpha', correction)]],
		],
		[
			'marking a line as continuing a corrected word',
			[
				[text('beta'), space, text('al', correction)],
				{ wrapped: true, items: [text('pha')] },
			],
		],
	])('equal the rows parsed from the file after %s', async (_name, lines) => {
		await createRichTranscription(versesDocument({ 'Romans 1:1': 'alpha' }));

		await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: TRANSCRIPTION_ID,
				document: throughEditor(await storedDocument(), typedDocument(lines)),
			},
			{ backend }
		);

		await expectRowsMatchFile();
		expect(
			await verifyTranscriptionIndexRows(harness.db, TRANSCRIPTION_ID, { backend })
		).toMatchObject({ status: 'verified', warnings: [] });
	});

	it('read-back check replaces rows from a file the codec wrote differently', async () => {
		await createRichTranscription(versesDocument({ 'Romans 1:1': 'alpha' }));
		codec.rewrite = xml => xml.replace('alpha', 'omega');

		await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: TRANSCRIPTION_ID,
				document: versesDocument({ 'Romans 1:1': 'alpha', 'Romans 1:2': 'beta' }),
			},
			{ backend }
		);
		expect(await storedContent()).toContain('alpha');
		expect(await rowsVerified()).toBe(0);

		const result = await verifyTranscriptionIndexRows(harness.db, TRANSCRIPTION_ID, {
			backend,
		});

		expect(result).toMatchObject({
			status: 'corrected',
			warnings: [
				{
					code: 'index_rows_corrected',
					entityType: 'transcription',
					entityId: TRANSCRIPTION_ID,
				},
			],
		});
		expect(await storedContent()).toContain('omega');
		expect(await storedContent()).not.toContain('alpha');
		await expectRowsMatchFile();
		expect(await rowsVerified()).toBe(1);
	});

	it('keeps verse row ids across a text edit and reports new verses', async () => {
		await createRichTranscription(
			versesDocument({ 'Romans 1:1': 'alpha', 'Romans 1:2': 'beta', 'Romans 1:3': 'gamma' })
		);
		const before = await verseRowIds();

		const edited = await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: TRANSCRIPTION_ID,
				document: versesDocument({
					'Romans 1:1': 'alpha',
					'Romans 1:2': 'betta',
					'Romans 1:3': 'gamma',
				}),
			},
			{ backend }
		);

		expect(edited).toEqual({ verseSetChanged: false });
		expect(await verseRowIds()).toEqual(before);
		expect(await storedContent()).toContain('betta');

		const inserted = await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: TRANSCRIPTION_ID,
				document: versesDocument({
					'Romans 1:1': 'alpha',
					'Romans 1:2': 'betta',
					'Romans 1:3': 'gamma',
					'Romans 1:4': 'delta',
				}),
			},
			{ backend }
		);

		expect(inserted).toEqual({ verseSetChanged: true });
		const after = await verseRowIds();
		expect(Object.keys(after)).toEqual([
			'Romans 1:1',
			'Romans 1:2',
			'Romans 1:3',
			'Romans 1:4',
		]);
		expect(after).toMatchObject(before);
	});

	it('rebuilds the same index a live save wrote, apart from ids', async () => {
		await createRichTranscription({
			...versesDocument({ 'Romans 1:1': 'alpha', 'Romans 1:2': 'beta' }),
			referenceEditionsUsed: ['NA28'],
			referenceEditionAttributions: { NA28: 'Nestle–Aland 28th edition' },
		});
		await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: TRANSCRIPTION_ID,
				document: versesDocument({ 'Romans 1:1': 'alpha', 'Romans 1:2': 'bet' }),
			},
			{ backend }
		);
		await verifyTranscriptionIndexRows(harness.db, TRANSCRIPTION_ID, { backend });
		const live = await indexSnapshot();

		await rebuildIndexFromStore(harness.db, { backend });

		expect(await indexSnapshot()).toEqual(live);
	});
});

async function createRichTranscription(document: StoredTranscriptionDocument): Promise<void> {
	await createTranscriptionWithFiles(
		harness.db,
		{
			id: TRANSCRIPTION_ID,
			projectId: PROJECT_ID,
			projectTranscriptionId: PROJECT_TRANSCRIPTION_ID,
			title: 'Romans witness',
			siglum: 'W1',
			description: 'A synthetic description',
			tags: ['igntp', 'romans'],
			transcriber: 'A. Transcriber',
			repository: 'A Library',
			settlement: 'A City',
			language: 'grc',
			owner: 'An Owner',
			isPublic: true,
			document,
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		},
		{ backend }
	);
	const [first, second = first] = (await storedDocument()).pages;
	const manifest = await ensureManifestSourceWithFiles(
		harness.db,
		{
			transcriptionId: TRANSCRIPTION_ID,
			manifestUrl: 'https://example.org/manifest.json',
			label: 'Manifest',
			metadata: { b: 'second', a: 'first' },
		},
		{ backend }
	);
	for (const [index, page] of [first, second].entries())
		await upsertPageCanvasLinkWithFiles(
			harness.db,
			{
				transcriptionId: TRANSCRIPTION_ID,
				pageId: page.pageId!,
				pageNameSnapshot: page.id,
				pageOrder: index + 1,
				manifestSourceId: manifest.id,
				manifestUrlSnapshot: 'https://example.org/manifest.json',
				canvasId: `canvas-${index + 1}`,
				canvasOrder: index + 1,
				canvasLabel: `Canvas ${index + 1}`,
				imageServiceUrl: null,
				thumbnailUrl: null,
				linkRole: index === 0 ? 'primary' : 'secondary',
			},
			{ backend }
		);
	await upsertCanvasAnnotationWithFiles(
		harness.db,
		{
			transcriptionId: TRANSCRIPTION_ID,
			manifestSourceId: manifest.id,
			pageId: first.pageId!,
			canvasId: 'canvas-1',
			anchor: { pageId: first.pageId! },
			annotation: {
				'@context': 'http://www.w3.org/ns/anno.jsonld',
				id: 'anno-1',
				type: 'Annotation',
				body: [{ type: 'TextualBody', value: 'note', purpose: 'commenting' }],
				target: { source: 'canvas-1' },
			},
		},
		{ backend }
	);
}

function versesDocument(texts: Record<string, string>): StoredTranscriptionDocument {
	const items = verseMilestones(Object.keys(texts)).flatMap((item): LineItem[] =>
		item.type === 'milestone' && item.kind === 'verse'
			? [
					item,
					{
						type: 'text',
						text: texts[`${item.attrs.book} ${item.attrs.chapter}:${item.attrs.verse}`],
					},
				]
			: [item]
	);
	return {
		type: 'transcriptionDocument',
		pages: [
			{
				type: 'page',
				id: '1r',
				pageId: 'page-1r',
				columns: [
					{ type: 'column', number: 1, lines: [{ type: 'line', number: 1, items }] },
				],
			},
		],
	};
}

type TypedLine = LineItem[] | { wrapped: true; items: LineItem[] };

// Starts Romans 1:1 on the first line.
function typedDocument(lines: TypedLine[]): StoredTranscriptionDocument {
	const typed = lines.map(line => (Array.isArray(line) ? { items: line } : line));
	typed[0] = { ...typed[0], items: [...verseMilestones(['Romans 1:1']), ...typed[0].items] };
	return {
		type: 'transcriptionDocument',
		pages: [
			{
				type: 'page',
				id: '1r',
				pageId: 'page-1r',
				columns: [
					{
						type: 'column',
						number: 1,
						lines: typed.map((line, index) => ({
							type: 'line',
							number: index + 1,
							...line,
						})),
					},
				],
			},
		],
	};
}

// Loads `shown` into the editor schema, which reorders marks, and saves its pages as the editor does.
function throughEditor(
	canonical: StoredTranscriptionDocument,
	shown = canonical
): StoredTranscriptionDocument {
	const doc = editorSchema.nodeFromJSON(prepareManuscriptDocumentEntry(toProseMirror(shown)).doc);
	const { pages } = createPageConversionCache()(doc);
	return mergeWithCanonicalDocument(canonical, { type: 'transcriptionDocument', pages });
}

// Converts through the editor, then adds a page and verse the editor creates bare.
function editLikeTheEditor(stored: StoredTranscriptionDocument): StoredTranscriptionDocument {
	const edited = throughEditor(stored);
	const textItem = edited.pages
		.flatMap(page => page.columns.flatMap(column => column.lines.flatMap(line => line.items)))
		.find(item => item.type === 'text' && item.text.trim());
	if (textItem?.type !== 'text') throw new Error('Document has no text to edit.');
	textItem.text = `${textItem.text}ϛ`;
	const verse = edited.pages
		.flatMap(page => page.columns.flatMap(column => column.lines.flatMap(line => line.items)))
		.findLast(item => item.type === 'milestone' && item.kind === 'verse');
	edited.pages.push({
		type: 'page',
		id: 'added',
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
								attrs: {
									...(verse?.type === 'milestone' ? verse.attrs : {}),
									verse: '99',
								},
							},
							{ type: 'text', text: 'ωω', marks: [] },
						],
					},
				],
			},
		],
	});
	return edited;
}

async function storedContent(): Promise<string> {
	const row = await harness.db
		.selectFrom('transcriptions')
		.select('content_json')
		.where('id', '=', TRANSCRIPTION_ID)
		.executeTakeFirstOrThrow();
	return row.content_json;
}

async function storedDocument(): Promise<StoredTranscriptionDocument> {
	return JSON.parse(await storedContent()) as StoredTranscriptionDocument;
}

async function rowsVerified(): Promise<number | undefined> {
	return (
		await harness.db
			.selectFrom('document_file_fingerprints')
			.select('rows_verified')
			.where('path', '=', documentCanonicalPath('transcription', PROJECT_TRANSCRIPTION_ID))
			.executeTakeFirst()
	)?.rows_verified;
}

async function verseRowIds(): Promise<Record<string, string | null>> {
	const rows = await harness.db
		.selectFrom('transcription_verse_index')
		.select(['id', 'verse_identifier'])
		.where('transcription_id', '=', TRANSCRIPTION_ID)
		.orderBy('verse_identifier')
		.execute();
	return Object.fromEntries(rows.map(row => [row.verse_identifier, row.id]));
}

async function expectRowsMatchFile(): Promise<void> {
	const xml = await readTextFile(
		joinStorePath(
			projectFolder(PROJECT_SLUG),
			documentCanonicalPath('transcription', PROJECT_TRANSCRIPTION_ID)
		),
		{ backend }
	);
	const expected = transcriptionIndexRowsFromPrimary(PROJECT_ID, parseTranscriptionTei(xml));
	const { content_json: expectedContent, ...expectedFields } = expected.transcription;
	const { content_json: storedJson, ...storedFields } = await harness.db
		.selectFrom('transcriptions')
		.selectAll()
		.where('id', '=', TRANSCRIPTION_ID)
		.executeTakeFirstOrThrow();
	expect(firstDifference(storedJson, expectedContent)).toBeNull();
	expect(storedFields).toEqual(expectedFields);
	for (const [table, rows] of [
		['iiif_manifest_sources', expected.iiifManifestSources],
		['transcription_page_canvas_links', expected.pageCanvasLinks],
		['iiif_canvas_annotations', expected.canvasAnnotations],
	] as const) {
		const stored = await harness.db
			.selectFrom(table)
			.selectAll()
			.where('transcription_id', '=', TRANSCRIPTION_ID)
			.orderBy('id')
			.execute();
		expect(stored).toEqual([...rows].sort((a, b) => a.id.localeCompare(b.id)));
		expect(stored.length).toBeGreaterThan(0);
	}
}

function firstDifference(actual: string, expected: string): string | null {
	if (actual === expected) return null;
	let index = 0;
	while (actual[index] === expected[index]) index += 1;
	const around = (value: string) => value.slice(Math.max(0, index - 200), index + 200);
	return `at ${index}:\nstored   ${around(actual)}\nexpected ${around(expected)}`;
}

const SNAPSHOT_TABLES = [
	'transcriptions',
	'project_transcriptions',
	'transcription_verse_index',
	'transcription_verse_index_state',
	'transcription_slice_chunks',
	'iiif_manifest_sources',
	'transcription_page_canvas_links',
	'iiif_canvas_annotations',
	'document_file_fingerprints',
	'transcription_checkpoints',
] as const;

async function indexSnapshot(): Promise<Record<string, unknown[]>> {
	const snapshot: Record<string, unknown[]> = {};
	for (const table of SNAPSHOT_TABLES) {
		const rows = (await harness.db.selectFrom(table).selectAll().execute()) as Record<
			string,
			unknown
		>[];
		snapshot[table] = rows
			.map(row => {
				const kept = { ...row };
				if (table === 'transcription_verse_index') delete kept.id;
				delete kept.last_indexed_at;
				return JSON.stringify(kept, (_key, value) =>
					value instanceof Uint8Array ? [...value] : value
				);
			})
			.sort();
	}
	return snapshot;
}

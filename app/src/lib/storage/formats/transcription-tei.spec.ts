import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importTEIDocument } from '$lib/tei/tei-importer';
import { extractTranscriptionRecordMetadataPatch } from '$lib/tei/transcription-record-metadata';
import {
	addReferenceEditionUsed,
	coerceTranscriptionDocument,
	TRANSCRIPTION_FORMAT,
} from '$lib/transcription/content';

import type { JsonValue } from '../envelope';
import {
	parseTranscriptionTei,
	rewriteTranscriptionTeiVersion,
	serializeTranscriptionTei,
	type TranscriptionTeiRecord,
	type TranscriptionTeiVersion,
} from './transcription-tei';

const transcriptions = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'../../../../static/igntp/Romans_Greek_transcriptions'
);

const files = process.env.IGNTP_ROUND_TRIP_ALL
	? readdirSync(transcriptions).filter(file => file.endsWith('.xml'))
	: ['02', '04', '0150', '1319', '1739', '1909', 'L60', 'L1126', 'P46'].map(
			witness => `NT_GRC_${witness}_Rom.xml`
		);

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

afterEach(() => {
	vi.useRealTimers();
});

function importedRecord(file: string): TranscriptionTeiRecord {
	const document = importTEIDocument(readFileSync(join(transcriptions, file), 'utf8'));
	const patch = extractTranscriptionRecordMetadataPatch(document);
	const seeded = addReferenceEditionUsed(
		addReferenceEditionUsed(
			coerceTranscriptionDocument(document)!,
			'robinson-pierpont',
			'Maurice A. Robinson and William G. Pierpont, The New Testament in the Original Greek (2018).'
		),
		'user-0123abcd'
	);
	return {
		project_transcription_id: 'ptx-1',
		id: 'tx-1',
		canonical_transcription_id: 'canonical-1',
		based_on_checkpoint: { id: 'cp-1', content_hash: 'sha256:checkpoint' },
		draft: { saved_at: '2026-11-13T09:30:00.000Z', author_name: 'Ada Scholar' },
		origin: {
			source_type: 'igntp',
			source_project_id: null,
			source_transcription_id: 'source-tx',
			source_revision_id: 'source-rev',
			source_content_hash: 'sha256:source',
			source_captured_at: '2026-01-02T03:04:05.000Z',
		},
		title: 'Edited title of Romans',
		siglum: patch.siglum ?? '',
		description: 'First line of a description.\nSecond line & <markup>.',
		content_json: JSON.parse(JSON.stringify(seeded)) as JsonValue,
		content_format: TRANSCRIPTION_FORMAT,
		created_at: '2026-01-02T03:04:05.000Z',
		updated_at: '2026-11-13T09:30:00.000Z',
		owner: 'ada@example.org',
		is_public: true,
		tags: ['Romans', 'Pauline epistles'],
		transcriber: 'Edited Transcriber',
		repository: '',
		settlement: patch.settlement ?? '',
		language: patch.language ?? '',
		...iiifFixtures(seeded.pages.map(page => page.pageId!)),
	};
}

function iiifFixtures(
	pageIds: string[]
): Pick<
	TranscriptionTeiRecord,
	'iiif_manifest_sources' | 'page_canvas_links' | 'canvas_annotations'
> {
	const manifestUrl = 'https://example.org/iiif/romans/manifest.json';
	const syntheticUrl = 'urn:apatopwa:iiif:intf:20046:0a1b2c3d';
	const canvas = (index: number) => `https://example.org/iiif/romans/canvas/${index}`;
	const syntheticCanvas = (index: number) => `${syntheticUrl}/canvas/${index}`;
	const page = (index: number) => pageIds[Math.min(index, pageIds.length - 1)];
	const link = (
		id: string,
		pageIndex: number,
		sourceId: string,
		canvasId: string,
		canvasOrder: number,
		overrides: Partial<TranscriptionTeiRecord['page_canvas_links'][number]> = {}
	) => ({
		id,
		page_id: page(pageIndex),
		page_name_snapshot: `${pageIndex + 1}r`,
		page_order: pageIndex + 1,
		manifest_source_id: sourceId,
		manifest_url_snapshot: sourceId === 'src-a' ? manifestUrl : syntheticUrl,
		canvas_id: canvasId,
		canvas_order: canvasOrder,
		canvas_label: `f. ${canvasOrder}`,
		image_service_url: `https://images.example.org/iiif/${id}`,
		thumbnail_url: `https://images.example.org/thumb/${id}.jpg`,
		link_role: 'primary',
		...overrides,
	});
	const annotation = (
		id: string,
		anchor: JsonValue,
		overrides: Partial<TranscriptionTeiRecord['canvas_annotations'][number]> = {}
	) => ({
		id,
		manifest_source_id: 'src-a',
		canvas_id: canvas(1),
		page_id: page(0),
		annotation_id: `https://example.org/annotations/${id}`,
		annotation_kind: 'FragmentSelector',
		body_json: [{ type: 'TextualBody', purpose: 'commenting', value: `Note on ${id}.` }],
		target_json: {
			source: canvas(1),
			selector: {
				type: 'FragmentSelector',
				conformsTo: 'http://www.w3.org/TR/media-frags/',
				value: 'xywh=pixel:10,20,300,40',
			},
		},
		anchor_json: anchor,
		motivation: 'commenting',
		created_by: 'ada@example.org',
		...overrides,
	});
	const pageAnchor = { pageId: page(0), pageName: '1r', pageOrder: 1 };
	return {
		iiif_manifest_sources: [
			{
				id: 'src-a',
				manifest_url: manifestUrl,
				label: 'Romans facsimile',
				source_kind: 'external',
				default_canvas_id: canvas(1),
				default_image_service_url: 'https://images.example.org/iiif/default',
				synthetic_canvases: [],
			},
			{
				id: 'src-b',
				manifest_url: syntheticUrl,
				label: 'P46 (INTF 20046)',
				source_kind: 'external',
				default_canvas_id: null,
				default_image_service_url: null,
				synthetic_canvases: [1, 2].map(index => ({
					canvas_id: syntheticCanvas(index),
					label: `${index}r`,
					width: 1500,
					height: 2000.5,
					image_url: `https://images.example.org/intf/${index}.jpg`,
					thumbnail_url:
						index === 1 ? 'https://images.example.org/intf/1-thumb.jpg' : null,
					metadata: [
						{ label: 'folio', value: `${index}r` },
						{ label: 'pageID', value: String(400 + index) },
					],
				})),
			},
		],
		page_canvas_links: [
			link('link-1', 0, 'src-a', canvas(1), 1),
			link('link-2', 0, 'src-b', syntheticCanvas(1), 1, { link_role: 'secondary' }),
			link('link-3', 1, 'src-a', canvas(2), 2, {
				canvas_label: 'Folio\n2 verso',
				image_service_url: null,
				thumbnail_url: null,
				manifest_url_snapshot: 'https://example.org/iiif/romans/old-manifest.json',
			}),
			link('link-4', 2, 'src-a', canvas(3), 3, { page_name_snapshot: '' }),
		],
		canvas_annotations: [
			annotation('ann-1', {
				...pageAnchor,
				role: 'page',
				canvasId: canvas(1),
				manifestSourceId: 'src-a',
			}),
			annotation('ann-2', {
				...pageAnchor,
				role: 'column',
				columnId: 'col-1',
				quote: 'παυλος',
			}),
			annotation('ann-3', {
				...pageAnchor,
				role: 'line',
				columnId: 'col-1',
				lineId: 'line-3',
			}),
			annotation('ann-4', {
				...pageAnchor,
				role: 'line-range',
				lineId: 'line-3',
				lineEndId: 'line-5',
				quote: null,
			}),
			annotation('ann-5', { ...pageAnchor, role: 'marginalia', marginaliaId: 'margin-1' }),
			annotation('ann-6', { ...pageAnchor, role: 'note' }),
			annotation(
				'ann-7',
				{ ...pageAnchor, role: 'word-region', columnId: null },
				{
					body_json: [
						{
							type: 'TextualBody',
							purpose: 'tagging',
							format: 'text/html',
							value: '<b>tag</b>',
						},
					],
					target_json: {
						source: canvas(1),
						selector: { type: 'SvgSelector', value: '<svg><path d="M0 0"/></svg>' },
					},
					annotation_kind: 'SvgSelector',
					created_by: 'Ada Scholar',
				}
			),
			annotation('ann-8', null, {
				canvas_id: canvas(9),
				page_id: null,
				target_json: { source: canvas(9) },
				annotation_kind: null,
				created_by: '',
				motivation: 'describing',
				body_json: { id: 'https://example.org/body/1', type: 'SpecificResource' },
			}),
			annotation(
				'ann-9',
				{ pageId: page(1) },
				{
					manifest_source_id: 'src-b',
					canvas_id: syntheticCanvas(1),
					page_id: page(1),
					target_json: { source: syntheticCanvas(1) },
					created_by: null,
				}
			),
		],
	};
}

function inlineTei({ titleStmt = '', resources = '', facs = '' } = {}): string {
	return `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>Romans</title>${titleStmt}</titleStmt><publicationStmt><publisher>IGNTP</publisher></publicationStmt><sourceDesc><p>Manuscript</p></sourceDesc></fileDesc></teiHeader>${resources}<text xml:lang="grc"><body><pb xml:id="page-a" n="1r"${facs ? ` facs="${facs}"` : ''}/><cb n="1"/><lb n="1"/><w>παυλος</w></body></text></TEI>`;
}

async function rewritten(record: TranscriptionTeiRecord): Promise<TranscriptionTeiRecord> {
	return parseTranscriptionTei((await serializeTranscriptionTei(record)).xml);
}

// Export writes each page id as xml:id so ids stay stable; that attribute is the one intended addition.
function comparable(record: TranscriptionTeiRecord) {
	const {
		teiHeader: _teiHeader,
		metadata: _metadata,
		header: _header,
		...content
	} = record.content_json as any;
	return JSON.parse(
		JSON.stringify({
			...record,
			content_json: {
				...content,
				pages: content.pages.map(({ teiAttrs, ...page }: any) => {
					const { 'xml:id': id, ...rest } = teiAttrs ?? {};
					const attrs = id === page.pageId ? rest : { ...rest, 'xml:id': id };
					return Object.keys(attrs).length > 0 ? { ...page, teiAttrs: attrs } : page;
				}),
			},
		}).normalize('NFC')
	);
}

describe('transcription TEI codec over the IGNTP corpus', () => {
	it.each(files)(
		'round-trips %s with app record fields',
		async file => {
			const record = importedRecord(file);
			const written = await serializeTranscriptionTei(record);
			const parsed = parseTranscriptionTei(written.xml);

			expect(comparable(parsed)).toEqual(comparable(record));
			expect((await serializeTranscriptionTei(parsed)).xml).toBe(written.xml);
			expect(written.xml.match(/<pb\b[^>]*>/g)?.every(pb => pb.includes('xml:id="'))).toBe(
				true
			);
			expect(written.xml).toContain('#canvas-link-1 #canvas-link-2');
			expect(written.xml).not.toMatch(/metadata_json|manifestJson|"source":/);
		},
		120_000
	);
});

describe('transcription TEI determinism and hashes', () => {
	it('writes identical bytes for the same record on different days', async () => {
		const record = importedRecord(files[0]);
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-13T12:00:00.000Z'));
		const first = await serializeTranscriptionTei(record);
		vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'));
		const second = await serializeTranscriptionTei(record);

		expect(second).toEqual(first);
		expect(first.xml.endsWith('</TEI>\n')).toBe(true);
	});

	it('changes only the file hash when only the save time changes', async () => {
		const record = importedRecord(files[0]);
		const saved = await serializeTranscriptionTei(record);
		const resaved = await serializeTranscriptionTei({
			...record,
			updated_at: '2026-11-14T08:00:00.000Z',
			draft: { ...record.draft, saved_at: '2026-11-14T08:00:00.000Z' },
		});
		const edited = await serializeTranscriptionTei({ ...record, title: 'Another title' });

		expect(resaved.fileHash).not.toBe(saved.fileHash);
		expect(resaved.contentHash).toBe(saved.contentHash);
		expect(edited.fileHash).not.toBe(saved.fileHash);
		expect(edited.contentHash).not.toBe(saved.contentHash);
	});
});

describe('transcription TEI header patching', () => {
	it('clears every Transcribed by responsibility and edits only the first', async () => {
		const resp = (name: string) =>
			`<respStmt><resp>Transcribed by</resp><name>${name}</name></respStmt>`;
		const record = parseTranscriptionTei(
			inlineTei({ titleStmt: resp('First Hand') + resp('Second Hand') })
		);
		expect(record.transcriber).toBe('First Hand');

		const edited = await serializeTranscriptionTei({ ...record, transcriber: 'Editor' });
		expect(parseTranscriptionTei(edited.xml).transcriber).toBe('Editor');
		expect(edited.xml).toContain(resp('Second Hand'));

		const cleared = await serializeTranscriptionTei({ ...record, transcriber: '' });
		expect(parseTranscriptionTei(cleared.xml).transcriber).toBe('');
		expect(cleared.xml).not.toContain('Transcribed by');
	});

	it('adds langUsage only when the language differs from the text language', async () => {
		const record = parseTranscriptionTei(inlineTei());
		expect(record.language).toBe('grc');
		const unchanged = await serializeTranscriptionTei(record);
		expect(unchanged.xml).not.toContain('langUsage');
		expect((await serializeTranscriptionTei(await rewritten(record))).xml).toBe(unchanged.xml);

		const edited = await serializeTranscriptionTei({ ...record, language: 'lat' });
		expect(edited.xml).toContain('<langUsage><language ident="lat"/></langUsage>');
		expect(edited.xml).toContain('<text xml:lang="lat">');
		const parsed = parseTranscriptionTei(edited.xml);
		expect(parsed.language).toBe('lat');
		expect((await serializeTranscriptionTei(parsed)).xml).toBe(edited.xml);
	});
});

describe('transcription TEI native facsimile links', () => {
	const resources =
		'<facsimile xml:id="facsimile"><surface xml:id="canvas-1"><graphic url="https://x/y"/></surface></facsimile>';

	it('keeps pb facs pointing to a native surface', async () => {
		const record = parseTranscriptionTei(inlineTei({ resources, facs: '#canvas-1' }));
		const written = await serializeTranscriptionTei(record);
		expect(written.xml).toContain('<pb xml:id="page-a" n="1r" facs="#canvas-1"/>');
		expect(written.xml).toContain('<surface xml:id="canvas-1">');
		const parsed = parseTranscriptionTei(written.xml);
		const { teiHeader: _parsedHeader, ...parsedContent } = parsed.content_json as any;
		const { teiHeader: _header, ...content } = record.content_json as any;
		expect(parsedContent).toEqual(content);
		expect((await serializeTranscriptionTei(parsed)).xml).toBe(written.xml);
	});

	it('keeps native facs beside app canvas links', async () => {
		const record = {
			...parseTranscriptionTei(inlineTei({ resources, facs: '#canvas-1' })),
			...iiifFixtures(['page-a']),
		};
		const written = await serializeTranscriptionTei(record);
		expect(written.xml).toContain('facs="#canvas-1 #canvas-link-1 #canvas-link-2');
		const parsed = parseTranscriptionTei(written.xml);
		expect(parsed).toEqual(await rewritten(record));
		expect(parsed.page_canvas_links).toEqual(record.page_canvas_links);
		expect((parsed.content_json as any).pages[0].teiAttrs.facs).toBe('#canvas-1');
	});
});

describe('transcription TEI Version rewrite', () => {
	const version: TranscriptionTeiVersion = {
		id: 'cp-1',
		label: 'Version 1',
		note: 'First',
		author_name: 'Ada Scholar',
		created_at: '2026-11-13T09:30:00.000Z',
		parent_id: null,
	};

	it('writes the same Version change the codec writes', async () => {
		const record = parseTranscriptionTei(inlineTei());
		const original = await serializeTranscriptionTei(record, version);
		const revised = { ...version, note: 'Revised & <checked>' };

		const result = await rewriteTranscriptionTeiVersion(original.xml, revised);

		expect(result).toEqual(await serializeTranscriptionTei(record, revised));
		expect(result.contentHash).toBe(original.contentHash);
	});
});

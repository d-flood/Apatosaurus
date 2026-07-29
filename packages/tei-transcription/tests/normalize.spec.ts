import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';

import {
	fromProseMirror,
	normalizeDocument,
	parseTei,
	type ProseMirrorJSON,
	type TranscriptionDocument,
} from '../src/index';

beforeAll(() => {
	if (typeof globalThis.DOMParser === 'undefined') {
		(globalThis as any).DOMParser = DOMParser;
	}
	if (typeof globalThis.Node === 'undefined') {
		class TestNode {}
		Object.assign(TestNode, {
			ELEMENT_NODE: 1,
			TEXT_NODE: 3,
			CDATA_SECTION_NODE: 4,
			PROCESSING_INSTRUCTION_NODE: 7,
			COMMENT_NODE: 8,
			DOCUMENT_NODE: 9,
			DOCUMENT_TYPE_NODE: 10,
			DOCUMENT_FRAGMENT_NODE: 11,
		});
		(globalThis as any).Node = TestNode;
	}
});

function pmLine(lineNumber: number, text?: string): ProseMirrorJSON {
	return {
		type: 'line',
		attrs: { lineNumber },
		...(text ? { content: [{ type: 'text', text }] } : {}),
	};
}

function pmDocument(lines: ProseMirrorJSON[]): ProseMirrorJSON {
	return {
		type: 'manuscript',
		content: [
			{
				type: 'page',
				attrs: { pageName: '1r', pageId: 'page-1' },
				content: [{ type: 'column', attrs: { columnNumber: 1 }, content: lines }],
			},
		],
	};
}

function lineTexts(document_: TranscriptionDocument): string[] {
	return document_.pages[0].columns[0].lines.map(line =>
		line.items
			.map(item => (item.type === 'text' ? item.text : item.type === 'boundary' ? ' ' : ''))
			.join('')
	);
}

function lineNumbers(document_: TranscriptionDocument): number[] {
	return document_.pages[0].columns[0].lines.map(line => line.number);
}

describe('normalizeDocument structural guards', () => {
	// Ticket 08 (`refactor-transcription-editor`) flipped this expectation. It
	// used to assert that two empty lines collapsed to one, which is the defect
	// recorded as SPEC.md § D6 / INVENTORY.md F36: autosave normalized the
	// editor's own Enter-on-a-blank-line result away. Empty lines are now kept;
	// the guard that survives is the structural one — a column is never empty.
	it('keeps every empty line, and synthesizes one only for a column that has none', () => {
		const normalized = normalizeDocument({
			type: 'transcriptionDocument',
			pages: [
				{
					type: 'page',
					id: '1r',
					columns: [
						{
							type: 'column',
							number: 1,
							lines: [
								{ type: 'line', number: 1, items: [] },
								{ type: 'line', number: 2, items: [] },
							],
						},
						{ type: 'column', number: 2, lines: [] },
					],
				},
			],
		} satisfies TranscriptionDocument);

		expect(normalized.pages[0].columns[0].lines).toEqual([
			{ type: 'line', number: 1, items: [] },
			{ type: 'line', number: 2, items: [] },
		]);
		expect(normalized.pages[0].columns[1].lines).toEqual([
			{ type: 'line', number: 1, items: [] },
		]);
	});

	it('keeps at least one column in every page', () => {
		const normalized = normalizeDocument({
			type: 'transcriptionDocument',
			pages: [
				{
					type: 'page',
					id: '1v',
					columns: [],
				},
			],
		} satisfies TranscriptionDocument);

		expect(normalized.pages[0].columns).toHaveLength(1);
		expect(normalized.pages[0].columns[0]).toMatchObject({
			type: 'column',
			number: 1,
			lines: [{ type: 'line', number: 1, items: [] }],
		});
	});
});

describe('empty lines survive the save path (SPEC.md D6 / INVENTORY.md F36)', () => {
	it('carries a blank line through fromProseMirror wherever it sits, with contiguous numbering', () => {
		const document_ = fromProseMirror(
			pmDocument([pmLine(1, 'alpha'), pmLine(2), pmLine(3, 'beta'), pmLine(4)])
		);

		expect(lineTexts(document_)).toEqual(['alpha', '', 'beta', '']);
		expect(lineNumbers(document_)).toEqual([1, 2, 3, 4]);
	});

	it('keeps every line of an all-empty column rather than collapsing to one', () => {
		const document_ = fromProseMirror(pmDocument([pmLine(1), pmLine(2), pmLine(3)]));

		expect(lineTexts(document_)).toEqual(['', '', '']);
		expect(lineNumbers(document_)).toEqual([1, 2, 3]);
	});

	it('is idempotent over a document containing blank lines', () => {
		const document_ = fromProseMirror(
			pmDocument([pmLine(1, 'alpha'), pmLine(2), pmLine(3, 'beta'), pmLine(4)])
		);

		const once = normalizeDocument(document_);
		expect(normalizeDocument(once)).toEqual(once);
	});

	it('drops a line whose only content is whitespace boundaries, since the user typed no line there', () => {
		const document_ = normalizeDocument({
			type: 'transcriptionDocument',
			pages: [
				{
					type: 'page',
					id: '1r',
					columns: [
						{
							type: 'column',
							number: 1,
							lines: [
								{
									type: 'line',
									number: 1,
									items: [{ type: 'boundary', kind: 'word' }],
								},
							],
						},
					],
				},
			],
		} satisfies TranscriptionDocument);

		// The trailing-boundary trim empties the line; the line itself stays.
		expect(document_.pages[0].columns[0].lines).toEqual([
			{ type: 'line', number: 1, items: [] },
		]);
	});

	it('does not gain a blank line when TEI is imported', () => {
		const document_ = parseTei(`<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader></teiHeader>
  <text><body>
    <pb n="1r"/><cb n="1"/>
    <lb n="1"/><w>alpha</w>
    <lb n="2"/>
    <lb n="3"/><w>beta</w>
    <lb n="4"/>
  </body></text>
</TEI>`);

		expect(lineTexts(document_)).toEqual(['alpha', 'beta']);
	});
});

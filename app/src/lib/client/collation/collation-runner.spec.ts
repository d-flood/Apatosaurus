import { describe, expect, it } from 'vitest';
import { fromProseMirror, type ProseMirrorJSON } from '@apatopwa/tei-transcription';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { extractWitnessTokensForVerse } from './collation-runner';

function buildPmDocument(lineContent: ProseMirrorJSON[]): ProseMirrorJSON {
	return {
		type: 'manuscript',
		content: [
			{
				type: 'page',
				attrs: { pageName: 'p1' },
				content: [
					{
						type: 'column',
						attrs: { columnNumber: 1 },
						content: [
							{
								type: 'line',
								attrs: { lineNumber: 1 },
								content: [
									{
										type: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									...lineContent,
								],
							},
						],
					},
				],
			},
		],
	};
}

function buildAstDocument(
	pages: Array<{
		wrapped?: boolean;
		columns: Array<{
			wrapped?: boolean;
			lines: Array<{
				wrapped?: boolean;
				items: Array<Record<string, unknown>>;
			}>;
		}>;
	}>,
): StoredTranscriptionDocument {
	return {
		type: 'transcriptionDocument',
		pages: pages.map((page, pageIndex) => ({
			type: 'page',
			id: `p${pageIndex + 1}`,
			...(page.wrapped ? { wrapped: true } : {}),
			columns: page.columns.map((column, columnIndex) => ({
				type: 'column',
				number: columnIndex + 1,
				...(column.wrapped ? { wrapped: true } : {}),
				lines: column.lines.map((line, lineIndex) => ({
					type: 'line',
					number: lineIndex + 1,
					...(line.wrapped ? { wrapped: true } : {}),
					items: line.items,
				})),
			})),
		})),
	} as unknown as StoredTranscriptionDocument;
}

describe('extractWitnessTokensForVerse', () => {
	it('uses transcription boundaries created during prose mirror import', () => {
		const document = fromProseMirror(
			buildPmDocument([
				{
					type: 'text',
					text: 'The cat sat on the mat',
				},
			]),
		);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1');

		expect(tokens.map((token) => token.original)).toEqual(['The', 'cat', 'sat', 'on', 'the', 'mat']);
	});

	it('keeps wrapped line continuations in one token', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'part1' },
								],
							},
							{
								wrapped: true,
								items: [{ type: 'text', text: 'part2' }, { type: 'boundary', kind: 'word' }],
							},
							{
								items: [{ type: 'text', text: 'next' }],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1');

		expect(tokens.map((token) => token.original)).toEqual(['part1\\npart2', 'next']);
	});

	it('can ignore wrapped line break markers in original tokens', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'part1' },
								],
							},
							{
								wrapped: true,
								items: [{ type: 'text', text: 'part2' }, { type: 'boundary', kind: 'word' }],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1', { ignoreWordBreaks: true });

		expect(tokens.map((token) => token.original)).toEqual(['part1part2']);
	});

	it('drops formatting whitespace around wrapped continuations', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'κλη\n' },
								],
							},
							{
								wrapped: true,
								items: [{ type: 'text', text: 'τος' }, { type: 'boundary', kind: 'word' }],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1');

		expect(tokens.map((token) => token.original)).toEqual(['κλη\\nτος']);
	});

	it('emits punctuation-marked text as a standalone token', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'λογος' },
									{
										type: 'text',
										text: ',',
										marks: [{ type: 'punctuation' }],
									},
									{ type: 'text', text: 'θεος' },
								],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1');

		expect(tokens.map((token) => token.original)).toEqual(['λογος', ',', 'θεος']);
		expect(tokens[1]?.segments).toEqual([
			{ text: ',', hasUnclear: false, isPunctuation: true, isSupplied: false },
		]);
	});

	it('keeps wrapped column continuations in one token', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'part1' },
								],
							},
						],
					},
					{
						wrapped: true,
						lines: [
							{
								wrapped: true,
								items: [{ type: 'text', text: 'part2' }, { type: 'boundary', kind: 'word' }],
							},
							{
								items: [{ type: 'text', text: 'next' }],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1');

		expect(tokens.map((token) => token.original)).toEqual(['part1\\cpart2', 'next']);
	});

	it('can ignore wrapped column break markers in original tokens', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'part1' },
								],
							},
						],
					},
					{
						wrapped: true,
						lines: [
							{
								wrapped: true,
								items: [{ type: 'text', text: 'part2' }, { type: 'boundary', kind: 'word' }],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1', { ignoreWordBreaks: true });

		expect(tokens.map((token) => token.original)).toEqual(['part1part2']);
	});

	it('keeps wrapped page continuations in one token', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'part1' },
								],
							},
						],
					},
				],
			},
			{
				wrapped: true,
				columns: [
					{
						wrapped: true,
						lines: [
							{
								wrapped: true,
								items: [{ type: 'text', text: 'part2' }, { type: 'boundary', kind: 'word' }],
							},
							{
								items: [{ type: 'text', text: 'next' }],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1');

		expect(tokens.map((token) => token.original)).toEqual(['part1\\ppart2', 'next']);
	});

	it('can ignore wrapped page break markers in original tokens', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'part1' },
								],
							},
						],
					},
				],
			},
			{
				wrapped: true,
				columns: [
					{
						wrapped: true,
						lines: [
							{
								wrapped: true,
								items: [{ type: 'text', text: 'part2' }, { type: 'boundary', kind: 'word' }],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1', { ignoreWordBreaks: true });

		expect(tokens.map((token) => token.original)).toEqual(['part1part2']);
	});

	it('does not leak wrapped page markers from the previous verse', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'part1' },
								],
							},
						],
					},
				],
			},
			{
				wrapped: true,
				columns: [
					{
						wrapped: true,
						lines: [
							{
								wrapped: true,
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '2' },
									},
									{ type: 'text', text: 'start' },
									{ type: 'boundary', kind: 'word' },
								],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:2');

		expect(tokens.map((token) => token.original)).toEqual(['start']);
	});

	it('preserves wrapped page markers that occur inside the target verse before the first word', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
								],
							},
						],
					},
				],
			},
			{
				wrapped: true,
				columns: [
					{
						wrapped: true,
						lines: [
							{
								wrapped: true,
								items: [
									{ type: 'text', text: 'start' },
									{ type: 'boundary', kind: 'word' },
								],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1');

		expect(tokens.map((token) => token.original)).toEqual(['\\pstart']);
	});

	it('keeps inline no-break break items in one token', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'part1' },
									{ type: 'lineBreak', attrs: { break: 'no' } },
									{ type: 'text', text: 'part2' },
									{ type: 'boundary', kind: 'word' },
									{ type: 'text', text: 'next' },
								],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1');

		expect(tokens.map((token) => token.original)).toEqual(['part1\\npart2', 'next']);
	});

	it('can ignore inline no-break markers in original tokens', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'part1' },
									{ type: 'lineBreak', attrs: { break: 'no' } },
									{ type: 'text', text: 'part2' },
									{ type: 'boundary', kind: 'word' },
								],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1', { ignoreWordBreaks: true });

		expect(tokens.map((token) => token.original)).toEqual(['part1part2']);
	});

	it('splits tokens on explicit break items without no-break markup', () => {
		const document = buildAstDocument([
			{
				columns: [
					{
						lines: [
							{
								items: [
									{
										type: 'milestone',
										kind: 'verse',
										attrs: { book: 'John', chapter: '1', verse: '1' },
									},
									{ type: 'text', text: 'part1' },
									{ type: 'lineBreak', attrs: {} },
									{ type: 'text', text: 'part2' },
								],
							},
						],
					},
				],
			},
		]);

		const tokens = extractWitnessTokensForVerse(document, 'John 1:1');

		expect(tokens.map((token) => token.original)).toEqual(['part1', 'part2']);
	});
});

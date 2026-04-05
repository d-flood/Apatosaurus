import { describe, it, expect } from 'vitest';
import {
	extractVersesFromJSON,
	normalizeVerseIdentifier,
	aggregateVerses,
	sortVerses,
} from './gather-verses';

describe('Verse Gathering', () => {
	describe('normalizeVerseIdentifier', () => {
		it('should normalize a complete verse reference', () => {
			const verse = { book: 'Romans', chapter: '1', verse: '1' };
			expect(normalizeVerseIdentifier(verse)).toBe('Romans 1:1');
		});

		it('should handle verse without verse number', () => {
			const verse = { book: 'Romans', chapter: '1', verse: '' };
			expect(normalizeVerseIdentifier(verse)).toBe('Romans 1');
		});

		it('should handle verse without chapter', () => {
			const verse = { book: 'Romans', chapter: '', verse: '' };
			expect(normalizeVerseIdentifier(verse)).toBe('Romans');
		});

		it('should handle completely empty verse', () => {
			const verse = { book: '', chapter: '', verse: '' };
			expect(normalizeVerseIdentifier(verse)).toBe('Unknown');
		});

		it('should handle verse with only verse number', () => {
			const verse = { book: 'Romans', chapter: '', verse: '1' };
			expect(normalizeVerseIdentifier(verse)).toBe('Romans 1');
		});
	});

	describe('aggregateVerses', () => {
		it('should aggregate verses and count occurrences', () => {
			const verses = [
				{ book: 'Romans', chapter: '1', verse: '1' },
				{ book: 'Romans', chapter: '1', verse: '1' },
				{ book: 'Romans', chapter: '1', verse: '2' },
			];

			const aggregated = aggregateVerses(verses);
			expect(aggregated.size).toBe(2);
			expect(aggregated.get('Romans 1:1')?.count).toBe(2);
			expect(aggregated.get('Romans 1:2')?.count).toBe(1);
		});

		it('should preserve verse attributes in aggregation', () => {
			const verses = [{ book: 'Matthew', chapter: '3', verse: '16' }];
			const aggregated = aggregateVerses(verses);
			const result = aggregated.get('Matthew 3:16');

			expect(result?.book).toBe('Matthew');
			expect(result?.chapter).toBe('3');
			expect(result?.verse).toBe('16');
		});
	});

	describe('sortVerses', () => {
		it('should sort verses by biblical book order', () => {
			const verses = [
				{ identifier: 'Matthew 1:1', book: 'Matthew', chapter: '1', verse: '1', count: 1 },
				{ identifier: 'Genesis 1:1', book: 'Genesis', chapter: '1', verse: '1', count: 1 },
				{ identifier: 'Romans 1:1', book: 'Romans', chapter: '1', verse: '1', count: 1 },
			];

			const sorted = sortVerses(verses);
			expect(sorted[0].book).toBe('Genesis');
			expect(sorted[1].book).toBe('Matthew');
			expect(sorted[2].book).toBe('Romans');
		});

		it('should sort verses by chapter number within same book', () => {
			const verses = [
				{ identifier: 'Romans 3:1', book: 'Romans', chapter: '3', verse: '1', count: 1 },
				{ identifier: 'Romans 1:1', book: 'Romans', chapter: '1', verse: '1', count: 1 },
				{ identifier: 'Romans 2:1', book: 'Romans', chapter: '2', verse: '1', count: 1 },
			];

			const sorted = sortVerses(verses);
			expect(sorted[0].chapter).toBe('1');
			expect(sorted[1].chapter).toBe('2');
			expect(sorted[2].chapter).toBe('3');
		});

		it('should sort verses by verse number within same chapter', () => {
			const verses = [
				{ identifier: 'Romans 1:3', book: 'Romans', chapter: '1', verse: '3', count: 1 },
				{ identifier: 'Romans 1:1', book: 'Romans', chapter: '1', verse: '1', count: 1 },
				{ identifier: 'Romans 1:2', book: 'Romans', chapter: '1', verse: '2', count: 1 },
			];

			const sorted = sortVerses(verses);
			expect(sorted[0].verse).toBe('1');
			expect(sorted[1].verse).toBe('2');
			expect(sorted[2].verse).toBe('3');
		});

		it('should handle unknown books by sorting to end', () => {
			const verses = [
				{ identifier: 'Matthew 1:1', book: 'Matthew', chapter: '1', verse: '1', count: 1 },
				{ identifier: 'Unknown Book 1:1', book: 'Unknown Book', chapter: '1', verse: '1', count: 1 },
				{ identifier: 'Genesis 1:1', book: 'Genesis', chapter: '1', verse: '1', count: 1 },
			];

			const sorted = sortVerses(verses);
			expect(sorted[0].book).toBe('Genesis');
			expect(sorted[1].book).toBe('Matthew');
			expect(sorted[2].book).toBe('Unknown Book');
		});
	});

	describe('extractVersesFromJSON', () => {
		it('should extract verses from ProseMirror JSON with verse nodes', () => {
			const verses: any[] = [];
			const pmJSON = {
				type: 'manuscript',
				content: [
					{
						type: 'page',
						content: [
							{
								type: 'column',
								content: [
									{
										type: 'line',
										content: [
											{
												type: 'verse',
												attrs: { book: 'Romans', chapter: '1', verse: '1' },
											},
											{
												type: 'text',
												text: 'Some text',
											},
										],
									},
								],
							},
						],
					},
				],
			};

			extractVersesFromJSON(pmJSON, verses);
			expect(verses.length).toBe(1);
			expect(verses[0]).toEqual({ book: 'Romans', chapter: '1', verse: '1' });
		});

		it('should extract multiple verses from nested structure', () => {
			const verses: any[] = [];
			const pmJSON = {
				type: 'manuscript',
				content: [
					{
						type: 'page',
						content: [
							{
								type: 'column',
								content: [
									{
										type: 'line',
										content: [
											{
												type: 'verse',
												attrs: { book: 'Romans', chapter: '1', verse: '1' },
											},
										],
									},
									{
										type: 'line',
										content: [
											{
												type: 'verse',
												attrs: { book: 'Romans', chapter: '1', verse: '2' },
											},
										],
									},
								],
							},
						],
					},
				],
			};

			extractVersesFromJSON(pmJSON, verses);
			expect(verses.length).toBe(2);
			expect(verses[0]).toEqual({ book: 'Romans', chapter: '1', verse: '1' });
			expect(verses[1]).toEqual({ book: 'Romans', chapter: '1', verse: '2' });
		});

		it('should handle JSON without verses', () => {
			const verses: any[] = [];
			const pmJSON = {
				type: 'manuscript',
				content: [
					{
						type: 'page',
						content: [
							{
								type: 'column',
								content: [
									{
										type: 'line',
										content: [
											{
												type: 'text',
												text: 'Just some text',
											},
										],
									},
								],
							},
						],
					},
				],
			};

			extractVersesFromJSON(pmJSON, verses);
			expect(verses.length).toBe(0);
		});

		it('should handle empty or null nodes', () => {
			const verses: any[] = [];
			extractVersesFromJSON(null, verses);
			expect(verses.length).toBe(0);

			extractVersesFromJSON(undefined, verses);
			expect(verses.length).toBe(0);

			extractVersesFromJSON({}, verses);
			expect(verses.length).toBe(0);
		});

		it('should handle verse nodes with missing attributes', () => {
			const verses: any[] = [];
			const pmJSON = {
				type: 'manuscript',
				content: [
					{
						type: 'page',
						content: [
							{
								type: 'column',
								content: [
									{
										type: 'line',
										content: [
											{
												type: 'verse',
												attrs: { book: 'Romans', chapter: '', verse: '' },
											},
										],
									},
								],
							},
						],
					},
				],
			};

			extractVersesFromJSON(pmJSON, verses);
			expect(verses.length).toBe(1);
			expect(verses[0]).toEqual({ book: 'Romans', chapter: '', verse: '' });
		});
	});
});

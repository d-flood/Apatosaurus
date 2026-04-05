import { describe, expect, it } from 'vitest';

import { summarizeImportedTeiDocument } from './imported-tei-summary';

describe('summarizeImportedTeiDocument', () => {
	it('surfaces hands, verse coverage, and structural counts for imported TEI', () => {
		const summary = summarizeImportedTeiDocument({
			metadata: {
				title: 'A transcription of Romans in 01',
				idno: 'MS Add. 43725',
				repository: 'British Library',
				settlement: 'London',
				language: 'grc',
			},
			header: {
				witnessIds: ['firsthand', 'corrector1'],
				msDescription: {
					msName: 'Codex 01',
					hands: [
						{ attrs: { 'xml:id': 'firsthand' }, text: 'first hand' },
						{ attrs: { 'xml:id': 'corrector1' }, text: 'corrector hand' },
					],
				},
			},
			pages: [
				{
					type: 'page',
					id: 'p1',
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
									kind: 'book',
									attrs: { book: 'Rom' },
								},
								{
									type: 'milestone',
									kind: 'chapter',
									attrs: { book: 'Rom', chapter: '1' },
								},
								{
									type: 'milestone',
									kind: 'verse',
									attrs: { book: 'Rom', chapter: '1', verse: '1' },
								},
								{
									type: 'text',
									text: 'alpha',
									marks: [
										{
											type: 'correction',
											attrs: {
												corrections: [
													{
														hand: '#corrector1',
														content: [{ type: 'text', text: 'beta' }],
													},
												],
											},
										},
									],
								},
								{
									type: 'handShift',
									attrs: { new: '#h2', medium: 'ink' },
								},
								{
									type: 'fw',
									attrs: { type: 'runTitle' },
									content: [{ type: 'text', text: 'προς ρωμαιους' }],
								},
								{
									type: 'gap',
									attrs: { reason: 'lacuna', unit: 'verse', extent: 'part' },
								},
								{
									type: 'untranscribed',
									attrs: { reason: 'damaged', extent: 'partial' },
								},
							],
						},
						{
									type: 'line',
									number: 2,
									items: [
										{
											type: 'milestone',
											kind: 'verse',
											attrs: { book: 'Rom', chapter: '1', verse: '2' },
										},
									],
								},
							],
						},
					],
				},
			],
		});

		expect(summary.title).toBe('A transcription of Romans in 01');
		expect(summary.siglum).toBe('MS Add. 43725');
		expect(summary.hands).toEqual([
			'firsthand',
			'corrector1',
			'firsthand: first hand',
			'corrector1: corrector hand',
		]);
		expect(summary.pageCount).toBe(1);
		expect(summary.columnCount).toBe(1);
		expect(summary.lineCount).toBe(2);
		expect(summary.bookIdentifiers).toEqual(['Rom']);
		expect(summary.chapterIdentifiers).toEqual(['Rom 1']);
		expect(summary.baseHand).toBe('firsthand');
		expect(summary.correctionSiteCount).toBe(1);
		expect(summary.correctionReadingCount).toBe(1);
		expect(summary.correctionHands).toEqual(['corrector1']);
		expect(summary.handShiftTargets).toEqual(['h2']);
		expect(summary.marginaliaCount).toBe(1);
		expect(summary.gapCount).toBe(1);
		expect(summary.untranscribedCount).toBe(1);
		expect(summary.verseIdentifiers).toEqual(['Rom 1:1', 'Rom 1:2']);
		expect(summary.firstVerse).toBe('Rom 1:1');
		expect(summary.lastVerse).toBe('Rom 1:2');
	});
});

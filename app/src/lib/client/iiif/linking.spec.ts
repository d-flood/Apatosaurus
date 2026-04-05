import { describe, expect, it } from 'vitest';

import { createIntfAutoLinkPlan, createSmartLinkPlan, normalizeFolioToken } from './linking';

const pages = [
	{ pageId: 'p1', pageName: '1r', pageOrder: 1 },
	{ pageId: 'p2', pageName: '1v', pageOrder: 2 },
	{ pageId: 'p3', pageName: '2r', pageOrder: 3 },
];

const canvases = [
	{ manifestId: 'm1', canvasId: 'c1', canvasLabel: '1r', canvasOrder: 1, imageServiceUrl: null, thumbnailUrl: null },
	{ manifestId: 'm1', canvasId: 'c2', canvasLabel: '1v', canvasOrder: 2, imageServiceUrl: null, thumbnailUrl: null },
	{ manifestId: 'm1', canvasId: 'c3', canvasLabel: '2r', canvasOrder: 3, imageServiceUrl: null, thumbnailUrl: null },
];

describe('createSmartLinkPlan', () => {
	it('builds a sequential assignment when the selected ranges match', () => {
		const plan = createSmartLinkPlan({
			pages,
			canvases,
			startPageId: 'p1',
			endPageId: 'p3',
			startCanvasId: 'c1',
			endCanvasId: 'c3',
		});

		expect(plan.status).toBe('ready');
		expect(plan.assignments).toHaveLength(3);
		expect(plan.assignments[1]).toMatchObject({
			page: { pageId: 'p2' },
			canvas: { canvasId: 'c2' },
		});
	});

	it('reports a mismatch when the selected ranges have different lengths', () => {
		const plan = createSmartLinkPlan({
			pages,
			canvases,
			startPageId: 'p1',
			endPageId: 'p3',
			startCanvasId: 'c1',
			endCanvasId: 'c2',
		});

		expect(plan.status).toBe('mismatch');
		expect(plan.assignments).toHaveLength(0);
		expect(plan.pageCount).toBe(3);
		expect(plan.canvasCount).toBe(2);
	});

	it('rejects reversed ranges', () => {
		const plan = createSmartLinkPlan({
			pages,
			canvases,
			startPageId: 'p3',
			endPageId: 'p1',
			startCanvasId: 'c3',
			endCanvasId: 'c1',
		});

		expect(plan.status).toBe('invalid');
		expect(plan.assignments).toHaveLength(0);
	});
});

describe('INTF auto-linking', () => {
	it('normalizes common folio variants', () => {
		expect(normalizeFolioToken(' Fol. 002r ')).toBe('2r');
		expect(normalizeFolioToken('2 verso')).toBe('2v');
		expect(normalizeFolioToken('2-r')).toBe('2r');
	});

	it('matches pages to canvases by normalized folio labels', () => {
		const plan = createIntfAutoLinkPlan({
			pages: [
				{ pageId: 'p1', pageName: 'custom', pageOrder: 1, matchCandidates: ['folio 001r'] },
				{ pageId: 'p2', pageName: 'custom', pageOrder: 2, matchCandidates: ['002v'] },
			],
			canvases: [
				{
					canvasId: 'c1',
					canvasLabel: '1r',
					canvasOrder: 1,
					imageServiceUrl: null,
					thumbnailUrl: null,
					folio: '1r',
					shelfFolioNums: '',
					sortOrder: 10,
				},
				{
					canvasId: 'c2',
					canvasLabel: '2v',
					canvasOrder: 2,
					imageServiceUrl: null,
					thumbnailUrl: null,
					folio: '2v',
					shelfFolioNums: '002v',
					sortOrder: 20,
				},
			],
		});

		expect(plan.matchedCount).toBe(2);
		expect(plan.assignments[0]).toMatchObject({
			page: { pageId: 'p1' },
			canvas: { canvasId: 'c1' },
			score: 100,
		});
	});

	it('skips ambiguous duplicate folio matches', () => {
		const plan = createIntfAutoLinkPlan({
			pages: [{ pageId: 'p1', pageName: '2r', pageOrder: 1, matchCandidates: ['2r'] }],
			canvases: [
				{
					canvasId: 'c1',
					canvasLabel: '2r (surr 10)',
					canvasOrder: 1,
					imageServiceUrl: null,
					thumbnailUrl: null,
					folio: '2r',
					shelfFolioNums: '002r',
					sortOrder: 10,
				},
				{
					canvasId: 'c2',
					canvasLabel: '2r (surr 20)',
					canvasOrder: 2,
					imageServiceUrl: null,
					thumbnailUrl: null,
					folio: '2r',
					shelfFolioNums: '002r',
					sortOrder: 20,
				},
			],
		});

		expect(plan.matchedCount).toBe(0);
		expect(plan.ambiguousCount).toBe(1);
	});

	it('skips low-confidence numeric-only matches', () => {
		const plan = createIntfAutoLinkPlan({
			pages: [{ pageId: 'p1', pageName: '2', pageOrder: 1, matchCandidates: ['2'] }],
			canvases: [
				{
					canvasId: 'c1',
					canvasLabel: '2r',
					canvasOrder: 1,
					imageServiceUrl: null,
					thumbnailUrl: null,
					folio: '2r',
					shelfFolioNums: '',
					sortOrder: 10,
				},
			],
		});

		expect(plan.matchedCount).toBe(0);
		expect(plan.skippedCount).toBe(1);
	});
});

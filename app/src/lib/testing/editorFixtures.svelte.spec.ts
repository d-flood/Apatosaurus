import { describe, expect, it } from 'vitest';

import {
	editorPlainPage,
	modelDocumentSnapshot,
	domDocumentSnapshot,
	structuralAttributeSnapshot,
} from './editorFixtures';

describe('editor test fixtures', () => {
	it('snapshots the whole model, DOM, and structural attributes', () => {
		const fixture = {
			type: 'manuscript',
			content: [
				{
					...editorPlainPage({
						pageId: 'page-x',
						texts: [
							['a', 'b', 'c', 'd'],
							['e', 'f', 'g', 'h'],
						],
					}),
				},
			],
		};
		const root = document.createElement('div');
		root.innerHTML = `
			<div class="page"><div class="column">
				<p class="line"><span class="line-content">a</span></p>
				<p class="line"><span class="line-content">b</span></p>
			</div></div>`;

		expect(modelDocumentSnapshot(fixture)).toEqual([
			[
				['a', 'b', 'c', 'd'],
				['e', 'f', 'g', 'h'],
			],
		]);
		expect(domDocumentSnapshot(root)).toEqual([[['a', 'b']]]);
		expect(structuralAttributeSnapshot(fixture)).toEqual([
			{
				attrs: { pageId: 'page-x', pageName: '1r' },
				columns: [
					{
						attrs: { columnId: 'col-1' },
						lines: [
							{ lineId: 'line-1' },
							{ lineId: 'line-2' },
							{ lineId: 'line-3' },
							{ lineId: 'line-4' },
						],
					},
					{
						attrs: { columnId: 'col-2' },
						lines: [
							{ lineId: 'line-5' },
							{ lineId: 'line-6' },
							{ lineId: 'line-7' },
							{ lineId: 'line-8' },
						],
					},
				],
			},
		]);
	});
});

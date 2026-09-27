import { describe, expect, it } from 'vitest';

import {
	editorColumn,
	editorDocument,
	editorFramedPage,
	editorPlainPage,
	marginaliaDocument,
	modelDocumentSnapshot,
	domDocumentSnapshot,
	structuralAttributeSnapshot,
	transcriptionDocument,
	transcriptionFramedPage,
	transcriptionPlainPage,
} from './editorFixtures';

describe('editor test fixtures', () => {
	it('builds deterministic non-degenerate editor JSON', () => {
		const first = editorDocument({});
		const second = editorDocument({});

		expect(second).toEqual(first);
		expect(first.type).toBe('manuscript');
		expect(first.content).toHaveLength(3);
		expect(first.content[1].content).toHaveLength(2);
		expect(first.content[1].content[0].content).toHaveLength(4);
		expect(first.content[1].content[0].attrs.columnId).toBe('col-2');
		expect(first.content[1].content[0].content[1].attrs.lineId).toBe('line-6');
	});

	it('builds composable plain and framed editor pages', () => {
		const plain = editorPlainPage({ pageId: 'custom-page' });
		const framed = editorFramedPage({ pageId: 'frame-page' });

		expect(plain.attrs.pageId).toBe('custom-page');
		expect(plain.content).toHaveLength(2);
		expect(plain.content.every((column: any) => column.content.length >= 4)).toBe(true);
		expect(framed.content.map((column: any) => column.attrs.zone)).toEqual([
			'top',
			'left',
			'center',
			'right',
			'bottom',
		]);
	});

	it('builds both document shapes and non-degenerate marginalia', () => {
		const domain = transcriptionDocument({});
		const marginalia = marginaliaDocument({});

		expect(domain.type).toBe('transcriptionDocument');
		expect(domain.pages).toHaveLength(3);
		expect(domain.pages[1].columns).toHaveLength(2);
		expect(domain.pages[1].columns[0].lines).toHaveLength(4);
		expect(transcriptionPlainPage({}).columns).toHaveLength(2);
		expect(transcriptionFramedPage({}).columns.map((column: any) => column.zone)).toEqual([
			'top',
			'left',
			'center',
			'right',
			'bottom',
		]);
		expect(marginalia.content).toHaveLength(2);
		expect(marginalia.content[0].content).toHaveLength(4);
	});

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

	it('lets callers provide a middle line without losing non-degenerate siblings', () => {
		const column = editorColumn({ texts: ['before', 'target', 'after', 'last'] });
		expect(
			modelDocumentSnapshot({
				type: 'manuscript',
				content: [{ type: 'page', attrs: {}, content: [column] }],
			})
		).toEqual([[['before', 'target', 'after', 'last']]]);
	});
});

import { describe, expect, it } from 'vitest';
import { Fragment, Slice } from '@tiptap/pm/model';

import {
	editorColumn,
	editorDocument,
	editorFramedPage,
	editorPlainPage,
	transcriptionDocument,
} from '$lib/client/testing/editorFixtures';
import {
	createTestEditor,
	mountTranscriptionEditor,
} from '$lib/client/testing/editorHarnesses.svelte';

function documentWithLines(lineCount: number) {
	return editorDocument({
		pages: [
			editorPlainPage({
				columns: [
					editorColumn({
						texts: Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`),
					}),
				],
			}),
		],
	});
}

function firstTextEnd(editor: ReturnType<typeof createTestEditor>): number {
	let end = -1;
	editor.state.doc.descendants((node, pos) => {
		if (end !== -1 || !node.isText) return end === -1;
		end = pos + node.nodeSize;
		return false;
	});
	if (end === -1) throw new Error('fixture has no text');
	return end;
}

function measureTyping(lineCount: number): number {
	const editor = createTestEditor({ content: documentWithLines(lineCount) });
	try {
		let position = firstTextEnd(editor);
		const samples = 20;
		const started = performance.now();
		for (let index = 0; index < samples; index += 1) {
			editor.view.dispatch(editor.state.tr.insertText('x', position, position));
			position += 1;
		}
		return (performance.now() - started) / samples;
	} finally {
		editor.destroy();
	}
}

describe('transcription editor keystroke path', () => {
	it('dispatches exactly one transaction per ordinary typed character', () => {
		const editor = createTestEditor({ content: documentWithLines(100) });
		let transactions = 0;
		editor.on('transaction', () => {
			transactions += 1;
		});

		try {
			let position = firstTextEnd(editor);
			for (let index = 0; index < 20; index += 1) {
				editor.view.dispatch(editor.state.tr.insertText('x', position, position));
				position += 1;
			}

			expect(transactions).toBe(20);
		} finally {
			editor.destroy();
		}
	});

	it('keeps per-keystroke cost flat as the manuscript grows', () => {
		const timings = [100, 250, 500].map(measureTyping);
		const spread = Math.max(...timings) - Math.min(...timings);

		expect(timings[2]).toBeLessThan(2);
		expect(spread).toBeLessThan(1);
	});
});

describe('transcription editor document-entry repair', () => {
	it('repairs missing structural ids when a stored transcription loads', async () => {
		const harness = await mountTranscriptionEditor({ document: transcriptionDocument({}) });
		try {
			const columns = Array.from(harness.container.querySelectorAll<HTMLElement>('.column'));
			const lines = Array.from(harness.container.querySelectorAll<HTMLElement>('.line'));

			expect(columns.length).toBeGreaterThan(0);
			expect(lines.length).toBeGreaterThan(0);
			expect(columns.every(column => Boolean(column.dataset.columnId))).toBe(true);
			expect(lines.every(line => Boolean(line.dataset.lineId))).toBe(true);
		} finally {
			harness.dispose();
		}
	});

	it('repairs a structural page slice at the paste boundary', () => {
		const editor = createTestEditor();
		try {
			const page = editor.schema.nodeFromJSON(
				editorFramedPage({
					texts: [['top'], ['left'], ['center'], ['right'], ['bottom']],
				})
			);
			const unpreparedPage = page.type.create(
				{ ...page.attrs, pageId: null },
				page.content.content.map(column =>
					column.type.create(
						{ ...column.attrs, columnId: null },
						column.content.content.map(line =>
						line.type.create({ ...line.attrs, lineId: null }, line.content)
					)
				)
				)
			);
			const slice = new Slice(Fragment.from(unpreparedPage), 0, 0);
			const transformed = editor.view.someProp('transformPasted', transform =>
				transform(slice, editor.view, false)
			);

			expect(transformed).toBeInstanceOf(Slice);
			const pastedPage = (transformed as Slice).content.firstChild!;
			expect(pastedPage.content.content.map(column => column.attrs.zone)).toEqual([
				'top',
				'left',
				'right',
				'bottom',
				'center',
			]);
			for (const column of pastedPage.content.content) {
				expect(column.attrs.columnId).toEqual(expect.any(String));
				expect(column.firstChild?.attrs.lineId).toEqual(expect.any(String));
			}
		} finally {
			editor.destroy();
		}
	});
});

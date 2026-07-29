import { TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import { editorColumn, editorDocument, editorPlainPage } from './testing/editorFixtures';
import { createTestEditor } from './testing/editorHarnesses.svelte';
import { createLineSplitTransaction } from './transcriptionEditorStructure';

function lineStart(document_: any, lineIndex: number): number {
	let position = 1;
	const page = document_.child(0);
	position += 1;
	const column = page.child(0);
	position += 1;
	for (let index = 0; index < lineIndex; index++) position += column.child(index).nodeSize;
	return position + 1;
}

function elementCount(node: Node): number {
	if (!(node instanceof Element)) return 0;
	return 1 + node.querySelectorAll('*').length;
}

describe('presentational transcription numbering', () => {
	it('keeps a 300-line middle split to constant DOM churn', async () => {
		const lines = Array.from({ length: 300 }, (_, index) => `line-${index + 1}`);
		const editor = createTestEditor({
			content: editorDocument({
				pages: [
					editorPlainPage({
						columns: [editorColumn({ texts: lines })],
					}),
				],
			}),
			attach: true,
		});
		try {
			const splitPosition = lineStart(editor.state.doc, 149) + 4;
			editor.view.dispatch(
				editor.state.tr.setSelection(TextSelection.create(editor.state.doc, splitPosition))
			);

			let created = 0;
			let destroyed = 0;
			const observer = new MutationObserver(records => {
				for (const record of records) {
					for (const node of record.addedNodes) created += elementCount(node);
					for (const node of record.removedNodes) destroyed += elementCount(node);
				}
			});
			observer.observe(editor.view.dom, { childList: true, subtree: true });

			const transaction = createLineSplitTransaction(editor.state);
			expect(transaction).not.toBeNull();
			editor.view.dispatch(transaction!);
			await Promise.resolve();
			observer.disconnect();

			expect(created).toBeLessThanOrEqual(10);
			expect(destroyed).toBeLessThanOrEqual(10);
		} finally {
			editor.view.dom.parentElement?.remove();
			editor.destroy();
		}
	});
});

import { describe, expect, it } from 'vitest';

import { createTestEditor } from '$lib/client/testing/editorHarnesses.svelte';
import type { ParsedReferenceEdition } from './source';
import { insertReferenceEditionRange } from './insertion';

const SOURCE: ParsedReferenceEdition = {
	units: [
		{
			position: 0,
			label: { unit: 'unit-1' },
			content: [{ type: 'text', text: 'seeded' }],
		},
	],
};

describe('reference edition insertion', () => {
	it('creates a page, column, and line when inserting into an empty document', () => {
		const editor = createTestEditor({ type: 'manuscript', content: [] });
		try {
			expect(insertReferenceEditionRange(editor, SOURCE, 0, 0)).toBe(true);

			const page = editor.state.doc.child(0);
			const column = page.child(0);
			const line = column.child(0);
			expect(page.type.name).toBe('page');
			expect(column.type.name).toBe('column');
			expect(line.type.name).toBe('line');
			expect(line.textContent).toBe('seeded');
			expect(line.firstChild?.marks.some(mark => mark.type.name === 'unconfirmed')).toBe(
				true
			);
		} finally {
			editor.destroy();
		}
	});

	it('does not replace structure for a non-empty selection', () => {
		const editor = createTestEditor();
		try {
			editor.commands.selectAll();
			const before = editor.state.doc.toJSON();

			expect(insertReferenceEditionRange(editor, SOURCE, 0, 0)).toBe(false);
			expect(editor.state.doc.toJSON()).toEqual(before);
		} finally {
			editor.destroy();
		}
	});
});
